// /api/disposal-requests
const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { notifyAdmins, notifyUser } = require('../utils/notificationHelper');
const { generateRequestNumber } = require('../utils/idGenerator');
const { requireAdmin } = require('../middleware/auth');
const { logAudit, getClientIp, getUserAgent } = require('../utils/auditLogger');
const { removeAlertsAndLog } = require('../utils/alertRemoval');

const MIN_REASON_LENGTH = 1;
const MAX_REASON_LENGTH = 500;

function sanitizeDisposalReason(str) {
    if (str == null) return '';
    return String(str).trim().slice(0, MAX_REASON_LENGTH);
}

// GET all disposal requests
router.get('/', async (req, res) => {
    try {
        const { status } = req.query;
        let query = `
            SELECT dr.*, p.name as productName, p.sku as productSku, b.lotCode, b.quantity as batchQty,
                u1.name as requestedByName, u2.name as approvedByName, u3.name as rejectedByName
            FROM disposal_requests dr
            INNER JOIN products p ON dr.productId = p.productId
            INNER JOIN batches b ON dr.batchId = b.batchId
            LEFT JOIN users u1 ON dr.requestedBy = u1.userId
            LEFT JOIN users u2 ON dr.approvedBy = u2.userId
            LEFT JOIN users u3 ON dr.rejectedBy = u3.userId
            WHERE 1=1
        `;
        const params = [];
        if (status) {
            query += ' AND dr.status = ?';
            params.push(status.toUpperCase());
        }
        query += ' ORDER BY dr.createdAt DESC';
        const [rows] = await db.execute(query, params);
        res.json({ success: true, count: rows.length, data: rows });
    } catch (err) {
        console.error('Error fetching disposal requests:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST create disposal request (reason mandatory; stock remains on hand until Admin approves)
router.post('/', async (req, res) => {
    try {
        const { batchId, productId, notes, requestedBy } = req.body;
        if (!batchId || !productId || !requestedBy) {
            return res.status(400).json({ success: false, error: 'batchId, productId, and requestedBy required' });
        }
        const reasonRaw = notes != null ? String(notes).trim() : '';
        if (reasonRaw.length < MIN_REASON_LENGTH) {
            return res.status(400).json({
                success: false,
                error: 'Reason for disposal is required (minimum 1 character).'
            });
        }
        const notesSanitized = sanitizeDisposalReason(notes);
        const requestNumber = await generateRequestNumber('disposal');
        const [result] = await db.execute(
            `INSERT INTO disposal_requests (requestNumber, batchId, productId, notes, requestedBy)
             VALUES (?, ?, ?, ?, ?)`,
            [requestNumber, batchId, productId, notesSanitized, requestedBy]
        );
        const [newRow] = await db.execute(
            `SELECT dr.*, p.name as productName, b.lotCode FROM disposal_requests dr
             INNER JOIN products p ON dr.productId = p.productId
             INNER JOIN batches b ON dr.batchId = b.batchId WHERE dr.disposalId = ?`,
            [result.insertId]
        );
        await notifyAdmins(`New disposal request ${requestNumber}: ${newRow[0].productName} - Batch ${newRow[0].lotCode}`, {
            triggeredBy: requestedBy, relatedEntityType: 'disposal_request', relatedEntityId: result.insertId
        });
        // Action-based alert removal: clear EXPIRED/NEAR_EXPIRY alerts for this batch
        await removeAlertsAndLog(
            { productId, batchId, alertTypes: ['EXPIRED', 'NEAR_EXPIRY'] },
            { userId: requestedBy, actionName: 'Request Disposal', req }
        );
        res.status(201).json({ success: true, message: 'Disposal request created', data: newRow[0] });
    } catch (err) {
        console.error('Error creating disposal request:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// PUT approve (Admin only; mandatory comment/reason; deducts inventory on approve)
router.put('/:id/approve', requireAdmin, async (req, res) => {
    try {
        const id = req.params.id;
        const approvedBy = req.user && req.user.userId;
        const reason = (req.body.reason != null ? String(req.body.reason) : req.body.approvalReason != null ? String(req.body.approvalReason) : '').trim();
        if (!reason) {
            return res.status(400).json({ success: false, error: 'Approval reason is required' });
        }
        const [existing] = await db.execute('SELECT * FROM disposal_requests WHERE disposalId = ?', [id]);
        if (!existing.length || existing[0].status !== 'PENDING') {
            return res.status(400).json({ success: false, error: 'Request not found or not pending' });
        }
        const rec = existing[0];
        const batchId = rec.batchId;
        const productId = rec.productId;
        const [[batchRow]] = await db.execute('SELECT quantity FROM batches WHERE batchId = ?', [batchId]);
        const qty = (batchRow && batchRow.quantity) || 0;
        await db.execute('UPDATE batches SET quantity = 0 WHERE batchId = ?', [batchId]);
        const [inv] = await db.execute('SELECT * FROM inventory_items WHERE productId = ?', [productId]);
        if (inv.length) {
            await db.execute(
                'UPDATE inventory_items SET totalQty = totalQty - ?, available = available - ? WHERE productId = ?',
                [qty, qty, productId]
            );
        }
        const approvalReason = reason.slice(0, 500);
        try {
            await db.execute(
                'UPDATE disposal_requests SET status = ? , approvedBy = ?, approvedDate = CURDATE(), approvalReason = ? WHERE disposalId = ?',
                ['APPROVED', approvedBy || null, approvalReason, id]
            );
        } catch (colErr) {
            if (colErr.code === 'ER_BAD_FIELD_ERROR' && colErr.message && colErr.message.includes('approvalReason')) {
                await db.execute(
                    'UPDATE disposal_requests SET status = ? , approvedBy = ?, approvedDate = CURDATE() WHERE disposalId = ?',
                    ['APPROVED', approvedBy || null, id]
                );
            } else throw colErr;
        }
        await logAudit({
            tableName: 'disposal_requests',
            recordId: parseInt(id),
            action: 'UPDATE',
            userId: approvedBy,
            userName: req.user && req.user.name,
            oldValues: { status: 'PENDING' },
            newValues: { status: 'APPROVED', approvedBy, batchId, productId, quantityDeducted: qty, approvalReason },
            ipAddress: getClientIp(req),
            userAgent: getUserAgent(req)
        });
        await notifyUser(rec.requestedBy, `Your disposal request ${rec.requestNumber} was approved. Reason: ${approvalReason}`,
            { triggeredBy: approvedBy, relatedEntityType: 'disposal_request', relatedEntityId: parseInt(id), notificationType: 'SUCCESS' });
        const [updated] = await db.execute('SELECT * FROM disposal_requests WHERE disposalId = ?', [id]);
        res.json({ success: true, data: updated[0] });
    } catch (err) {
        console.error('Error approving:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// PUT reject (Admin only)
router.put('/:id/reject', requireAdmin, async (req, res) => {
    try {
        const id = req.params.id;
        const { rejectedBy, rejectReason } = req.body;
        const [existing] = await db.execute('SELECT * FROM disposal_requests WHERE disposalId = ?', [id]);
        if (!existing.length || existing[0].status !== 'PENDING') {
            return res.status(400).json({ success: false, error: 'Request not found or not pending' });
        }
        await db.execute(
            'UPDATE disposal_requests SET status = ? , rejectedBy = ?, rejectedDate = CURDATE(), rejectReason = ? WHERE disposalId = ?',
            ['REJECTED', rejectedBy || null, rejectReason || null, id]
        );
        await notifyUser(existing[0].requestedBy,
            `Your disposal request ${existing[0].requestNumber} was rejected.${rejectReason ? ' Reason: ' + rejectReason : ''}`,
            { triggeredBy: rejectedBy, relatedEntityType: 'disposal_request', relatedEntityId: parseInt(id), notificationType: 'WARNING', rejectionReason: rejectReason || null });
        const [updated] = await db.execute('SELECT * FROM disposal_requests WHERE disposalId = ?', [id]);
        res.json({ success: true, data: updated[0] });
    } catch (err) {
        console.error('Error rejecting:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// PUT complete (record physical disposal; inventory already deducted on Approve)
router.put('/:id/complete', async (req, res) => {
    try {
        const disposalId = Number.parseInt(req.params.id, 10);
        if (Number.isNaN(disposalId)) {
            return res.status(400).json({ success: false, error: 'Invalid disposalId' });
        }
        const { completedBy } = req.body;

        const [existing] = await db.execute('SELECT * FROM disposal_requests WHERE disposalId = ?', [disposalId]);
        if (!existing.length) {
            return res.status(404).json({
                success: false,
                error: 'Request not found',
                disposalId
            });
        }

        const currentStatus = existing[0].status;
        if (currentStatus !== 'APPROVED') {
            const requestNumber = existing[0].requestNumber || null;
            const errByStatus = currentStatus === 'PENDING'
                ? 'Disposal request is not approved yet'
                : currentStatus === 'REJECTED'
                    ? 'Disposal request was rejected'
                    : currentStatus === 'COMPLETED'
                        ? 'Disposal is already completed'
                        : 'Request is not approved for completion';

            return res.status(400).json({
                success: false,
                error: errByStatus,
                disposalId,
                requestNumber,
                currentStatus
            });
        }
        await db.execute(
            'UPDATE disposal_requests SET status = ? , completedBy = ?, completedDate = CURDATE() WHERE disposalId = ?',
            ['COMPLETED', completedBy || null, disposalId]
        );
        const [updated] = await db.execute('SELECT * FROM disposal_requests WHERE disposalId = ?', [disposalId]);
        res.json({ success: true, data: updated[0] });
    } catch (err) {
        console.error('Error completing:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
