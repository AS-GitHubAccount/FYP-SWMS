// /api/purchase-requests
const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { notifyAdmins, notifyUser } = require('../utils/notificationHelper');
const { generateRequestNumber } = require('../utils/idGenerator');
const { removeAlertsAndLog } = require('../utils/alertRemoval');

const QUERY_TIMEOUT_MS = Number(process.env.PR_LIST_QUERY_TIMEOUT_MS || 20000);

function withQueryTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Database query timed out')), ms))
    ]);
}

// GET all purchase requests
// Query params: status, creatorId (requestedBy), startDate, endDate, page, limit
router.get('/', async (req, res) => {
    try {
        const { status, creatorId, startDate, endDate, page, limit } = req.query;
        let query = `
            SELECT pr.*, p.name as productName, p.sku as productSku,
                u1.name as requestedByName, u2.name as approvedByName,
                u3.name as rejectedByName, s.name as supplierName,
                r.rfqId, r.status as rfqStatus
            FROM purchase_requests pr
            INNER JOIN products p ON pr.productId = p.productId
            LEFT JOIN users u1 ON pr.requestedBy = u1.userId
            LEFT JOIN users u2 ON pr.approvedBy = u2.userId
            LEFT JOIN users u3 ON pr.rejectedBy = u3.userId
            LEFT JOIN suppliers s ON pr.supplierId = s.supplierId
            LEFT JOIN (
                SELECT purchaseRequestId, MIN(rfqId) AS rfqId
                FROM rfqs
                GROUP BY purchaseRequestId
            ) rfq_pick ON rfq_pick.purchaseRequestId = pr.requestId
            LEFT JOIN rfqs r ON r.rfqId = rfq_pick.rfqId
            WHERE 1=1
        `;
        const params = [];
        if (status) {
            query += ' AND pr.status = ?';
            params.push(status.toUpperCase());
        }
        if (creatorId) {
            query += ' AND pr.requestedBy = ?';
            params.push(parseInt(creatorId, 10));
        }
        if (startDate) {
            query += ' AND COALESCE(pr.requestedDate, pr.createdAt) >= ?';
            params.push(startDate);
        }
        if (endDate) {
            query += ' AND COALESCE(pr.requestedDate, pr.createdAt) <= ?';
            params.push(endDate);
        }
        query += ' ORDER BY pr.requestId DESC';

        const usePagination = page != null || limit != null;
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
        const offset = (pageNum - 1) * limitNum;

        let rows;
        if (usePagination) {
            const [r] = await withQueryTimeout(
                db.execute(query + ' LIMIT ? OFFSET ?', [...params, limitNum, offset]),
                QUERY_TIMEOUT_MS
            );
            rows = r;
        } else {
            const [r] = await withQueryTimeout(db.execute(query, params), QUERY_TIMEOUT_MS);
            rows = r;
        }

        let total = rows.length;
        if (usePagination) {
            const [countRows] = await withQueryTimeout(
                db.execute(
                    'SELECT COUNT(*) as total FROM purchase_requests pr WHERE 1=1' +
                    (status ? ' AND pr.status = ?' : '') +
                    (creatorId ? ' AND pr.requestedBy = ?' : '') +
                    (startDate ? ' AND COALESCE(pr.requestedDate, pr.createdAt) >= ?' : '') +
                    (endDate ? ' AND COALESCE(pr.requestedDate, pr.createdAt) <= ?' : ''),
                    params
                ),
                QUERY_TIMEOUT_MS
            );
            total = (countRows && countRows[0]) ? countRows[0].total : rows.length;
        }

        const payload = { success: true, count: rows.length, data: rows };
        if (usePagination) {
            payload.total = total;
            payload.page = pageNum;
            payload.limit = limitNum;
        }
        res.json(payload);
    } catch (err) {
        console.error('Error fetching purchase requests:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET single purchase request (with multi-suppliers)
router.get('/:id', async (req, res) => {
    try {
        const rawId = req.params.id;
        const id = rawId != null && rawId !== '' ? parseInt(String(rawId), 10) : NaN;
        if (isNaN(id) || id < 1) {
            return res.status(400).json({ success: false, error: `Invalid PR ID: ${rawId}. Expected a positive number.` });
        }
        const [rows] = await db.execute(`
            SELECT pr.*, p.name as productName, p.sku as productSku
            FROM purchase_requests pr
            INNER JOIN products p ON pr.productId = p.productId
            WHERE pr.requestId = ?
        `, [id]);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, error: `PR ID ${id} not found in database.` });
        }
        const pr = rows[0];
        const [rfqRow] = await db.execute('SELECT rfqId, status as rfqStatus FROM rfqs WHERE purchaseRequestId = ? LIMIT 1', [id]);
        if (rfqRow && rfqRow.length) {
            pr.rfqId = rfqRow[0].rfqId;
            pr.rfqStatus = rfqRow[0].rfqStatus;
        } else {
            pr.rfqId = null;
            pr.rfqStatus = null;
        }
        let [suppliers] = await db.execute(`
            SELECT s.supplierId, s.name as supplierName, s.email as supplierEmail
            FROM purchase_request_suppliers prs
            INNER JOIN suppliers s ON prs.supplierId = s.supplierId
            WHERE prs.requestId = ?
        `, [id]);
        if ((!suppliers || suppliers.length === 0) && pr.supplierId) {
            const [legacy] = await db.execute(
                'SELECT supplierId, name as supplierName, email as supplierEmail FROM suppliers WHERE supplierId = ?',
                [pr.supplierId]
            );
            suppliers = legacy || [];
        }
        pr.suppliers = suppliers || [];
        pr.supplierEmails = (suppliers || []).map(s => s.supplierEmail).filter(Boolean);
        res.json({ success: true, data: pr });
    } catch (err) {
        console.error('Error fetching purchase request:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST create purchase request
router.post('/', async (req, res) => {
    try {
        const {
            productId,
            quantity,
            supplierId,
            supplierIds,
            priority,
            neededBy,
            sendingLocation,
            notes,
            requestedBy
        } = req.body;
        if (!productId || !quantity || !requestedBy) {
            return res.status(400).json({ success: false, error: 'productId, quantity, and requestedBy required' });
        }
        if (quantity <= 0) {
            return res.status(400).json({ success: false, error: 'Quantity Required cannot be 0' });
        }
        const loc = (sendingLocation && String(sendingLocation).trim()) || '';
        if (!loc) {
            return res.status(400).json({ success: false, error: 'Sending location is required' });
        }
        const ids = Array.isArray(supplierIds) ? supplierIds : (supplierId ? [supplierId] : []);
        const primaryId = ids[0] || null;
        const requestNumber = await generateRequestNumber('purchase');
        const [result] = await db.execute(
            `INSERT INTO purchase_requests (requestNumber, productId, quantity, supplierId, priority, neededBy, sendingLocation, notes, requestedBy)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [requestNumber, productId, quantity, primaryId, priority || 'medium', neededBy || null, loc, notes || null, requestedBy]
        );
        const requestId = result.insertId;
        for (const sid of ids) {
            if (sid) await db.execute(
                'INSERT IGNORE INTO purchase_request_suppliers (requestId, supplierId) VALUES (?, ?)',
                [requestId, parseInt(sid)]
            );
        }
        const [newRow] = await db.execute(
            `SELECT pr.*, p.name as productName, p.sku FROM purchase_requests pr
             INNER JOIN products p ON pr.productId = p.productId WHERE pr.requestId = ?`,
            [requestId]
        );
        await notifyAdmins(`New purchase request ${requestNumber}: ${newRow[0].productName} x ${quantity}`, {
            triggeredBy: requestedBy, relatedEntityType: 'purchase_request', relatedEntityId: requestId
        });
        // Action-based alert removal: clear LOW_STOCK alert for this product
        await removeAlertsAndLog(
            { productId, alertTypes: ['LOW_STOCK'] },
            { userId: requestedBy, actionName: 'Purchase', req }
        );
        res.status(201).json({ success: true, message: 'Purchase request created', data: newRow[0] });
    } catch (err) {
        console.error('Error creating purchase request:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// PUT approve (approvalNote required, cannot be empty - no character minimum)
router.put('/:id/approve', async (req, res) => {
    try {
        const id = req.params.id;
        const { approvedBy, approvalNote } = req.body;
        const note = (approvalNote && String(approvalNote).trim()) || null;
        if (!note) {
            return res.status(400).json({ success: false, error: 'Approval note is required' });
        }
        const [existing] = await db.execute('SELECT * FROM purchase_requests WHERE requestId = ?', [id]);
        if (!existing.length || existing[0].status !== 'PENDING') {
            return res.status(400).json({ success: false, error: 'Request not found or not pending' });
        }
        try {
            await db.execute(
                'UPDATE purchase_requests SET status = ? , approvedBy = ?, approvedDate = CURDATE(), approvalNote = ? WHERE requestId = ?',
                ['APPROVED', approvedBy || null, note, id]
            );
        } catch (colErr) {
            if (colErr.code === 'ER_BAD_FIELD_ERROR' && colErr.message && colErr.message.includes('approvalNote')) {
                await db.execute(
                    'UPDATE purchase_requests SET status = ? , approvedBy = ?, approvedDate = CURDATE() WHERE requestId = ?',
                    ['APPROVED', approvedBy || null, id]
                );
            } else throw colErr;
        }
        await notifyUser(existing[0].requestedBy, `Your purchase request ${existing[0].requestNumber} was approved. Reason: ${note}`,
            { triggeredBy: approvedBy, relatedEntityType: 'purchase_request', relatedEntityId: parseInt(id), notificationType: 'SUCCESS' });
        const [updated] = await db.execute('SELECT * FROM purchase_requests WHERE requestId = ?', [id]);
        res.json({ success: true, data: updated[0] });
    } catch (err) {
        console.error('Error approving:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

const MIN_REASON_LENGTH = 1;

// PUT reject
router.put('/:id/reject', async (req, res) => {
    try {
        const id = req.params.id;
        const { rejectedBy, rejectReason } = req.body;
        const reasonVal = (rejectReason != null ? String(rejectReason) : '').trim();
        if (!reasonVal || reasonVal.length < MIN_REASON_LENGTH) {
            return res.status(400).json({ success: false, error: 'Reason is required and cannot be empty.' });
        }
        const [existing] = await db.execute('SELECT * FROM purchase_requests WHERE requestId = ?', [id]);
        if (!existing.length || existing[0].status !== 'PENDING') {
            return res.status(400).json({ success: false, error: 'Request not found or not pending' });
        }
        await db.execute(
            'UPDATE purchase_requests SET status = ? , rejectedBy = ?, rejectedDate = CURDATE(), rejectReason = ? WHERE requestId = ?',
            ['REJECTED', rejectedBy || null, reasonVal.slice(0, 500), id]
        );
        await notifyUser(existing[0].requestedBy,
            `Your purchase request ${existing[0].requestNumber} was rejected. Reason: ${reasonVal}`,
            { triggeredBy: rejectedBy, relatedEntityType: 'purchase_request', relatedEntityId: parseInt(id), notificationType: 'WARNING', rejectionReason: rejectReason || null });
        const [updated] = await db.execute('SELECT * FROM purchase_requests WHERE requestId = ?', [id]);
        res.json({ success: true, data: updated[0] });
    } catch (err) {
        console.error('Error rejecting:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
