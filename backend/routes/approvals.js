/**
 * Approvals API Routes
 *
 * Unified pending/approved/rejected/completed list for the Approval Center.
 *
 * GET /api/approvals?status=&type=
 * - status: all | pending | approved | rejected | completed
 * - type: all | disposal | booking | purchase | rfq_withdrawal
 *
 * Returns: { success, count, data: [...] }
 */

const express = require('express');
const router = express.Router();
const db = require('../config/database');

function normalizeStatus(status) {
    const s = String(status || '').toLowerCase().trim();
    if (!s) return 'pending';
    if (['all', 'pending', 'approved', 'rejected', 'completed'].includes(s)) return s;
    return 'pending';
}

function normalizeType(type) {
    const t = String(type || '').toLowerCase().trim();
    if (!t) return 'all';
    if (['all', 'disposal', 'booking', 'purchase', 'rfq_withdrawal'].includes(t)) return t;
    return 'all';
}

function statusToDbForDisposal(status) {
    if (status === 'all') return null;
    if (status === 'pending') return 'PENDING';
    if (status === 'approved') return 'APPROVED';
    if (status === 'rejected') return 'REJECTED';
    if (status === 'completed') return 'COMPLETED';
    return null;
}

function statusToDbForPurchase(status) {
    if (status === 'all') return null;
    if (status === 'pending') return 'PENDING';
    if (status === 'approved') return 'APPROVED';
    if (status === 'rejected') return 'REJECTED';
    return null;
}

function statusToDbForBooking(status) {
    if (status === 'all') return null;
    if (status === 'pending') return 'PENDING';
    if (status === 'approved') return 'APPROVED';
    // UI calls it "Rejected", but bookings cancellation uses "CANCELLED"
    if (status === 'rejected') return 'CANCELLED';
    if (status === 'completed') return 'FULFILLED';
    return null;
}

function statusToDbForRfq(status) {
    if (status === 'all') return null;
    if (status === 'pending') return 'WITHDRAW_PENDING';
    if (status === 'approved') return 'WITHDRAWN';
    // Rejected withdrawal reverts to SENT - no "rejected" rfq status; return null to get all
    if (status === 'rejected') return null;
    return null;
}

router.get('/', async (req, res) => {
    try {
        const status = normalizeStatus(req.query.status);
        const type = normalizeType(req.query.type);

        const items = [];

        // -------------------------
        // Disposal requests
        // -------------------------
        if (type === 'all' || type === 'disposal') {
            const dbStatus = statusToDbForDisposal(status);
            const where = dbStatus ? ' AND dr.status = ?' : " AND dr.status IN ('PENDING','APPROVED','REJECTED','COMPLETED')";
            const params = dbStatus ? [dbStatus] : [];

            const [rows] = await db.execute(`
                SELECT
                    dr.disposalId as id,
                    dr.requestNumber as reference,
                    dr.notes as notes,
                    dr.requestedBy,
                    dr.createdAt,
                    dr.status as status,
                    u.name as requestedByName,
                    COALESCE(p.name, p.sku) as productName,
                    p.sku as productSku,
                    b.lotCode,
                    b.quantity as batchQty
                FROM disposal_requests dr
                LEFT JOIN products p ON dr.productId = p.productId
                LEFT JOIN batches b ON dr.batchId = b.batchId
                LEFT JOIN users u ON dr.requestedBy = u.userId
                WHERE 1=1
                ${where}
                ORDER BY dr.createdAt DESC
            `, params);

            (rows || []).forEach(r => {
                items.push({
                    type: 'disposal',
                    id: r.id,
                    reference: r.reference || 'D-' + r.id,
                    description: (r.productName || r.productSku || '') +
                        (r.lotCode ? ' · Lot ' + r.lotCode : '') +
                        (r.notes ? ' · ' + r.notes : ''),
                    requestedByName: r.requestedByName || '—',
                    date: r.createdAt,
                    productName: r.productName,
                    lotCode: r.lotCode,
                    batchQty: r.batchQty,
                    notes: r.notes,
                    status: r.status
                });
            });
        }

        // -------------------------
        // Bookings
        // -------------------------
        if (type === 'all' || type === 'booking') {
            const dbStatus = statusToDbForBooking(status);
            const where = dbStatus ? ' AND b.status = ?' : '';
            const params = dbStatus ? [dbStatus] : [];

            const [rows] = await db.execute(`
                SELECT
                    b.bookingId as id,
                    b.bookingNumber as reference,
                    b.quantity,
                    b.requestedBy,
                    b.requestedDate as createdAt,
                    b.status as status,
                    u.name as requestedByName,
                    COALESCE(p.name, p.sku) as productName,
                    p.sku as productSku
                FROM bookings b
                LEFT JOIN products p ON b.productId = p.productId
                LEFT JOIN users u ON b.requestedBy = u.userId
                WHERE 1=1
                ${where}
                ORDER BY b.requestedDate DESC
            `, params);

            (rows || []).forEach(r => {
                items.push({
                    type: 'booking',
                    id: r.id,
                    reference: r.reference || 'B-' + r.id,
                    description: (r.productName || r.productSku || '') + ' · Qty ' + (r.quantity || 0),
                    requestedByName: r.requestedByName || '—',
                    date: r.createdAt,
                    productName: r.productName,
                    quantity: r.quantity,
                    status: r.status
                });
            });
        }

        // -------------------------
        // Purchase requests (no COMPLETED status in DB — skip entire block for "completed")
        // -------------------------
        if ((type === 'all' || type === 'purchase') && status !== 'completed') {
            const dbStatus = statusToDbForPurchase(status);
            const where = dbStatus ? ' AND pr.status = ?' : '';
            const params = dbStatus ? [dbStatus] : [];

            const [rows] = await db.execute(`
                SELECT
                    pr.requestId as id,
                    pr.requestNumber as reference,
                    pr.quantity,
                    pr.requestedBy,
                    pr.requestedDate as createdAt,
                    pr.status as status,
                    u.name as requestedByName,
                    COALESCE(p.name, p.sku) as productName,
                    p.sku as productSku
                FROM purchase_requests pr
                LEFT JOIN products p ON pr.productId = p.productId
                LEFT JOIN users u ON pr.requestedBy = u.userId
                WHERE 1=1
                ${where}
                ORDER BY pr.requestedDate DESC
            `, params);

            (rows || []).forEach(r => {
                items.push({
                    type: 'purchase_request',
                    id: r.id,
                    reference: r.reference || 'PR-' + r.id,
                    description: (r.productName || r.productSku || '') + ' · Qty ' + (r.quantity || 0),
                    requestedByName: r.requestedByName || '—',
                    date: r.createdAt,
                    productName: r.productName,
                    quantity: r.quantity,
                    status: r.status
                });
            });
        }

        // -------------------------
        // RFQ Withdrawal requests
        // Query rfqs directly first (no JOINs) so we never miss a pending withdrawal
        // "Completed" filter targets disposal COMPLETED + booking FULFILLED only (withdrawals show as Approved in UI)
        // -------------------------
        if ((type === 'all' || type === 'rfq_withdrawal') && status !== 'completed') {
            const dbStatus = statusToDbForRfq(status);
            const where = dbStatus ? ' AND r.status = ?' : " AND r.status IN ('WITHDRAW_PENDING','WITHDRAWN')";
            const params = dbStatus ? [dbStatus] : [];

            try {
                const [rows] = await db.execute(`
                    SELECT
                        r.rfqId as id,
                        r.rfqNumber as reference,
                        r.withdrawal_reason,
                        r.withdrawal_requested_at as createdAt,
                        r.status as status,
                        u.name as requestedByName,
                        (SELECT COALESCE(p.name, p.sku) FROM purchase_requests pr
                         LEFT JOIN products p ON pr.productId = p.productId
                         WHERE pr.requestId = r.purchaseRequestId LIMIT 1) as productName
                    FROM rfqs r
                    LEFT JOIN users u ON r.withdrawal_requested_by = u.userId
                    WHERE 1=1
                    ${where}
                    ORDER BY COALESCE(r.withdrawal_requested_at, r.createdAt) DESC
                `, params);

                (rows || []).forEach(r => {
                    const productPart = (r.productName || '') + (r.withdrawal_reason ? ' · ' + String(r.withdrawal_reason).slice(0, 80) : '');
                    const desc = productPart || (r.reference || 'RFQ') + (r.withdrawal_reason ? ' · ' + String(r.withdrawal_reason).slice(0, 80) : '');
                    const displayStatus = r.status === 'WITHDRAWN' ? 'APPROVED' : r.status === 'WITHDRAW_PENDING' ? 'PENDING' : r.status;
                    items.push({
                        type: 'rfq_withdrawal',
                        id: r.id,
                        reference: r.reference || 'RFQ-' + r.id,
                        description: desc || 'RFQ Withdrawal Request',
                        requestedByName: r.requestedByName || '—',
                        date: r.createdAt,
                        productName: r.productName,
                        withdrawalReason: r.withdrawal_reason,
                        status: displayStatus
                    });
                });
            } catch (e) {
                if (e.code !== 'ER_NO_SUCH_TABLE' && e.code !== 'ER_BAD_FIELD_ERROR') throw e;
            }
        }

        // Sort by date desc
        items.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

        res.json({ success: true, count: items.length, data: items });
    } catch (error) {
        console.error('Error fetching approvals:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;

