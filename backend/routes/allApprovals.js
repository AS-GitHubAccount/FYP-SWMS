/**
 * Master Approval endpoint - unified pending Disposals, Bookings, Purchase Requests
 * GET /api/all-approvals returns one list for the Approval Center page.
 * Query params: status=all (default) | PENDING | APPROVED | REJECTED
 * - all: pending + approved + rejected (single view)
 * - PENDING: only pending items
 * - APPROVED: only approved
 * - REJECTED: only rejected (bookings use CANCELLED)
 */

const express = require('express');
const router = express.Router();
const db = require('../config/database');

router.get('/', async (req, res) => {
    try {
        const rawStatus = (req.query.status || 'all').toString().trim();
        const statusParam = rawStatus.toUpperCase();
        const wantAll = statusParam === 'ALL' || rawStatus.toLowerCase() === 'all';
        const wantPending = statusParam === 'PENDING' || wantAll;
        const wantProcessed = wantAll || statusParam === 'PROCESSED' || statusParam === 'APPROVED' || statusParam === 'REJECTED';
        const wantApprovedOnly = statusParam === 'APPROVED' && !wantAll;
        const wantRejectedOnly = statusParam === 'REJECTED' && !wantAll;

        const items = [];

        if (wantPending) {
            // --- PENDING: disposal, bookings, purchase_requests, rfq_withdrawal ---
        try {
            const [disposals] = await db.execute(`
                SELECT dr.disposalId as id, dr.requestNumber as reference, dr.notes as description,
                    dr.requestedBy, dr.createdAt,
                    u.name as requestedByName, p.name as productName, p.sku as productSku, b.lotCode, b.quantity as batchQty
                FROM disposal_requests dr
                LEFT JOIN products p ON dr.productId = p.productId
                LEFT JOIN batches b ON dr.batchId = b.batchId
                LEFT JOIN users u ON dr.requestedBy = u.userId
                WHERE dr.status = 'PENDING'
                ORDER BY dr.createdAt DESC
            `);
            (disposals || []).forEach(r => {
                items.push({
                    type: 'disposal',
                    status: 'PENDING',
                    id: r.id,
                    reference: r.reference || 'D-' + r.id,
                    description: (r.productName || r.productSku || '') + (r.lotCode ? ' · Lot ' + r.lotCode : '') + (r.notes ? ' · ' + r.notes : ''),
                    requestedByName: r.requestedByName || '—',
                    date: r.createdAt,
                    productName: r.productName,
                    lotCode: r.lotCode,
                    batchQty: r.batchQty,
                    notes: r.notes
                });
            });
        } catch (e) {
            if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
        }

        try {
            const [bookings] = await db.execute(`
                SELECT b.bookingId as id, b.bookingNumber as reference, b.quantity,
                    b.requestedBy, b.requestedDate as createdAt,
                    u.name as requestedByName, p.name as productName, p.sku as productSku
                FROM bookings b
                INNER JOIN products p ON b.productId = p.productId
                LEFT JOIN users u ON b.requestedBy = u.userId
                WHERE b.status = 'PENDING'
                ORDER BY b.requestedDate DESC
            `);
            (bookings || []).forEach(r => {
                items.push({
                    type: 'booking',
                    status: 'PENDING',
                    id: r.id,
                    reference: r.reference || 'B-' + r.id,
                    description: (r.productName || r.productSku || '') + ' · Qty ' + (r.quantity || 0),
                    requestedByName: r.requestedByName || '—',
                    date: r.createdAt,
                    productName: r.productName,
                    quantity: r.quantity
                });
            });
        } catch (e) {
            if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
        }

        try {
            const [prs] = await db.execute(`
                SELECT pr.requestId as id, pr.requestNumber as reference, pr.quantity,
                    pr.requestedBy, pr.requestedDate as createdAt,
                    u.name as requestedByName, p.name as productName, p.sku as productSku
                FROM purchase_requests pr
                INNER JOIN products p ON pr.productId = p.productId
                LEFT JOIN users u ON pr.requestedBy = u.userId
                WHERE pr.status = 'PENDING'
                ORDER BY pr.requestedDate DESC
            `);
            (prs || []).forEach(r => {
                items.push({
                    type: 'purchase_request',
                    status: 'PENDING',
                    id: r.id,
                    reference: r.reference || 'PR-' + r.id,
                    description: (r.productName || r.productSku || '') + ' · Qty ' + (r.quantity || 0),
                    requestedByName: r.requestedByName || '—',
                    date: r.createdAt,
                    productName: r.productName,
                    quantity: r.quantity
                });
            });
        } catch (e) {
            if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
        }

        try {
            const [rfqs] = await db.execute(`
                SELECT r.rfqId as id, r.rfqNumber as reference, r.withdrawal_reason, r.withdrawal_requested_at as createdAt,
                    u.name as requestedByName, p.name as productName, p.sku as productSku
                FROM rfqs r
                INNER JOIN purchase_requests pr ON r.purchaseRequestId = pr.requestId
                INNER JOIN products p ON pr.productId = p.productId
                LEFT JOIN users u ON r.withdrawal_requested_by = u.userId
                WHERE r.status = 'WITHDRAW_PENDING'
                ORDER BY r.withdrawal_requested_at DESC
            `);
            (rfqs || []).forEach(r => {
                const desc = (r.productName || r.productSku || '') + (r.withdrawal_reason ? ' · ' + String(r.withdrawal_reason).slice(0, 80) : '');
                items.push({
                    type: 'rfq_withdrawal',
                    status: 'PENDING',
                    id: r.id,
                    reference: r.reference || 'RFQ-' + r.id,
                    description: desc,
                    requestedByName: r.requestedByName || '—',
                    date: r.createdAt,
                    productName: r.productName,
                    withdrawalReason: r.withdrawal_reason
                });
            });
        } catch (e) {
            if (e.code !== 'ER_NO_SUCH_TABLE' && e.code !== 'ER_BAD_FIELD_ERROR') throw e;
            }
        }

        if (wantProcessed) {
            // --- PROCESSED: disposal (APPROVED/REJECTED), bookings (APPROVED/CANCELLED), purchase_requests (APPROVED/REJECTED), rfqs (WITHDRAWN) ---
            const disposalStatus = wantApprovedOnly ? ['APPROVED'] : wantRejectedOnly ? ['REJECTED'] : ['APPROVED', 'REJECTED'];
            const bookingStatus = wantApprovedOnly ? ['APPROVED'] : wantRejectedOnly ? ['CANCELLED'] : ['APPROVED', 'CANCELLED'];
            const prStatus = wantApprovedOnly ? ['APPROVED'] : wantRejectedOnly ? ['REJECTED'] : ['APPROVED', 'REJECTED'];

            try {
                const placeholders = disposalStatus.map(() => '?').join(',');
                const [disposals] = await db.execute(`
                    SELECT dr.disposalId as id, dr.requestNumber as reference, dr.notes as description,
                        dr.status, dr.requestedBy, dr.createdAt, dr.approvedBy, dr.approvedDate, dr.rejectedBy, dr.rejectedDate,
                        dr.completedBy, dr.completedDate, dr.approvalReason, dr.rejectReason,
                        u1.name as requestedByName, u2.name as approvedByName, u3.name as rejectedByName, u4.name as completedByName,
                        p.name as productName, p.sku as productSku, b.lotCode, b.quantity as batchQty
                    FROM disposal_requests dr
                    LEFT JOIN products p ON dr.productId = p.productId
                    LEFT JOIN batches b ON dr.batchId = b.batchId
                    LEFT JOIN users u1 ON dr.requestedBy = u1.userId
                    LEFT JOIN users u2 ON dr.approvedBy = u2.userId
                    LEFT JOIN users u3 ON dr.rejectedBy = u3.userId
                    LEFT JOIN users u4 ON dr.completedBy = u4.userId
                    WHERE dr.status IN (${placeholders})
                    ORDER BY COALESCE(dr.completedDate, dr.approvedDate, dr.rejectedDate, dr.createdAt) DESC
                `, disposalStatus);
                (disposals || []).forEach(r => {
                    const isApproved = r.status === 'APPROVED';
                    const isCompleted = r.status === 'COMPLETED';
                    const resolvedBy = isCompleted ? (r.completedByName || '—') : isApproved ? (r.approvedByName || '—') : (r.rejectedByName || '—');
                    const resolvedAt = isCompleted ? r.completedDate : isApproved ? r.approvedDate : r.rejectedDate;
                    items.push({
                        type: 'disposal',
                        status: r.status,
                        id: r.id,
                        reference: r.reference || 'D-' + r.id,
                        description: (r.productName || r.productSku || '') + (r.lotCode ? ' · Lot ' + r.lotCode : '') + (r.notes ? ' · ' + r.notes : ''),
                        requestedByName: r.requestedByName || '—',
                        date: r.createdAt,
                        resolvedBy,
                        resolvedAt,
                        reason: isApproved ? (r.approvalReason || r.rejectReason || '') : (r.rejectReason || ''),
                        productName: r.productName,
                        lotCode: r.lotCode,
                        batchQty: r.batchQty,
                        notes: r.notes
                    });
                });
            } catch (e) {
                if (e.code === 'ER_BAD_FIELD_ERROR' && e.message && e.message.includes('approvalReason')) {
                    const placeholders = disposalStatus.map(() => '?').join(',');
                    const [disposals] = await db.execute(`
                        SELECT dr.disposalId as id, dr.requestNumber as reference, dr.notes as description,
                            dr.status, dr.requestedBy, dr.createdAt, dr.approvedBy, dr.approvedDate, dr.rejectedBy, dr.rejectedDate,
                            dr.completedBy, dr.completedDate, dr.rejectReason,
                            u1.name as requestedByName, u2.name as approvedByName, u3.name as rejectedByName, u4.name as completedByName,
                            p.name as productName, p.sku as productSku, b.lotCode, b.quantity as batchQty
                        FROM disposal_requests dr
                        LEFT JOIN products p ON dr.productId = p.productId
                        LEFT JOIN batches b ON dr.batchId = b.batchId
                        LEFT JOIN users u1 ON dr.requestedBy = u1.userId
                        LEFT JOIN users u2 ON dr.approvedBy = u2.userId
                        LEFT JOIN users u3 ON dr.rejectedBy = u3.userId
                        LEFT JOIN users u4 ON dr.completedBy = u4.userId
                        WHERE dr.status IN (${placeholders})
                        ORDER BY COALESCE(dr.completedDate, dr.approvedDate, dr.rejectedDate, dr.createdAt) DESC
                    `, disposalStatus);
                    (disposals || []).forEach(r => {
                        const isApproved = r.status === 'APPROVED';
                        const isCompleted = r.status === 'COMPLETED';
                        const resolvedBy = isCompleted ? (r.completedByName || '—') : isApproved ? (r.approvedByName || '—') : (r.rejectedByName || '—');
                        const resolvedAt = isCompleted ? r.completedDate : isApproved ? r.approvedDate : r.rejectedDate;
                        items.push({
                            type: 'disposal',
                            status: r.status,
                            id: r.id,
                            reference: r.reference || 'D-' + r.id,
                            description: (r.productName || r.productSku || '') + (r.lotCode ? ' · Lot ' + r.lotCode : '') + (r.notes ? ' · ' + r.notes : ''),
                            requestedByName: r.requestedByName || '—',
                            date: r.createdAt,
                            resolvedBy,
                            resolvedAt,
                            reason: isApproved ? '' : (r.rejectReason || ''),
                            productName: r.productName,
                            lotCode: r.lotCode,
                            batchQty: r.batchQty,
                            notes: r.notes
                        });
                    });
                } else if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
            }

            if (bookingStatus.length > 0) {
            try {
                const placeholders = bookingStatus.map(() => '?').join(',');
                const [bookings] = await db.execute(`
                    SELECT b.bookingId as id, b.bookingNumber as reference, b.quantity,
                        b.status, b.requestedBy, b.requestedDate as createdAt,
                        b.approvedBy, b.approvedDate, b.rejectReason, b.approvalReason,
                        u1.name as requestedByName, u2.name as approvedByName,
                        p.name as productName, p.sku as productSku
                    FROM bookings b
                    INNER JOIN products p ON b.productId = p.productId
                    LEFT JOIN users u1 ON b.requestedBy = u1.userId
                    LEFT JOIN users u2 ON b.approvedBy = u2.userId
                    WHERE b.status IN (${placeholders})
                    ORDER BY COALESCE(b.approvedDate, b.requestedDate) DESC
                `, bookingStatus);
                (bookings || []).forEach(r => {
                    const isApproved = r.status === 'APPROVED';
                    items.push({
                        type: 'booking',
                        status: r.status,
                        id: r.id,
                        reference: r.reference || 'B-' + r.id,
                        description: (r.productName || r.productSku || '') + ' · Qty ' + (r.quantity || 0),
                        requestedByName: r.requestedByName || '—',
                        date: r.createdAt,
                        resolvedBy: isApproved ? (r.approvedByName || '—') : '—',
                        resolvedAt: isApproved ? r.approvedDate : null,
                        reason: isApproved ? (r.approvalReason || '') : (r.rejectReason || ''),
                        productName: r.productName,
                        quantity: r.quantity
                    });
                });
            } catch (e) {
                if (e.code === 'ER_BAD_FIELD_ERROR' && e.message && e.message.includes('approvalReason')) {
                    const placeholders = bookingStatus.map(() => '?').join(',');
                    const [bookings] = await db.execute(`
                        SELECT b.bookingId as id, b.bookingNumber as reference, b.quantity,
                            b.status, b.requestedBy, b.requestedDate as createdAt,
                            b.approvedBy, b.approvedDate, b.rejectReason,
                            u1.name as requestedByName, u2.name as approvedByName,
                            p.name as productName, p.sku as productSku
                        FROM bookings b
                        INNER JOIN products p ON b.productId = p.productId
                        LEFT JOIN users u1 ON b.requestedBy = u1.userId
                        LEFT JOIN users u2 ON b.approvedBy = u2.userId
                        WHERE b.status IN (${placeholders})
                        ORDER BY COALESCE(b.approvedDate, b.requestedDate) DESC
                    `, bookingStatus);
                    (bookings || []).forEach(r => {
                        const isApproved = r.status === 'APPROVED';
                        items.push({
                            type: 'booking',
                            status: r.status,
                            id: r.id,
                            reference: r.reference || 'B-' + r.id,
                            description: (r.productName || r.productSku || '') + ' · Qty ' + (r.quantity || 0),
                            requestedByName: r.requestedByName || '—',
                            date: r.createdAt,
                            resolvedBy: isApproved ? (r.approvedByName || '—') : '—',
                            resolvedAt: isApproved ? r.approvedDate : null,
                            reason: isApproved ? '' : (r.rejectReason || ''),
                            productName: r.productName,
                            quantity: r.quantity
                        });
                    });
                } else if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
            }
            }

            if (prStatus.length > 0) {
            try {
                const placeholders = prStatus.map(() => '?').join(',');
                const [prs] = await db.execute(`
                    SELECT pr.requestId as id, pr.requestNumber as reference, pr.quantity,
                        pr.status, pr.requestedBy, pr.requestedDate as createdAt,
                        pr.approvedBy, pr.approvedDate, pr.rejectedBy, pr.rejectedDate,
                        pr.approvalNote, pr.rejectReason,
                        u1.name as requestedByName, u2.name as approvedByName, u3.name as rejectedByName,
                        p.name as productName, p.sku as productSku
                    FROM purchase_requests pr
                    INNER JOIN products p ON pr.productId = p.productId
                    LEFT JOIN users u1 ON pr.requestedBy = u1.userId
                    LEFT JOIN users u2 ON pr.approvedBy = u2.userId
                    LEFT JOIN users u3 ON pr.rejectedBy = u3.userId
                    WHERE pr.status IN (${placeholders})
                    ORDER BY COALESCE(pr.approvedDate, pr.rejectedDate, pr.requestedDate) DESC
                `, prStatus);
                (prs || []).forEach(r => {
                    const isApproved = r.status === 'APPROVED';
                    items.push({
                        type: 'purchase_request',
                        status: r.status,
                        id: r.id,
                        reference: r.reference || 'PR-' + r.id,
                        description: (r.productName || r.productSku || '') + ' · Qty ' + (r.quantity || 0),
                        requestedByName: r.requestedByName || '—',
                        date: r.createdAt,
                        resolvedBy: isApproved ? (r.approvedByName || '—') : (r.rejectedByName || '—'),
                        resolvedAt: isApproved ? r.approvedDate : r.rejectedDate,
                        reason: isApproved ? (r.approvalNote || '') : (r.rejectReason || ''),
                        productName: r.productName,
                        quantity: r.quantity
                    });
                });
            } catch (e) {
                if (e.code === 'ER_BAD_FIELD_ERROR' && e.message && e.message.includes('approvalNote')) {
                    const placeholders = prStatus.map(() => '?').join(',');
                    const [prs] = await db.execute(`
                        SELECT pr.requestId as id, pr.requestNumber as reference, pr.quantity,
                            pr.status, pr.requestedBy, pr.requestedDate as createdAt,
                            pr.approvedBy, pr.approvedDate, pr.rejectedBy, pr.rejectedDate,
                            pr.rejectReason,
                            u1.name as requestedByName, u2.name as approvedByName, u3.name as rejectedByName,
                            p.name as productName, p.sku as productSku
                        FROM purchase_requests pr
                        INNER JOIN products p ON pr.productId = p.productId
                        LEFT JOIN users u1 ON pr.requestedBy = u1.userId
                        LEFT JOIN users u2 ON pr.approvedBy = u2.userId
                        LEFT JOIN users u3 ON pr.rejectedBy = u3.userId
                        WHERE pr.status IN (${placeholders})
                        ORDER BY COALESCE(pr.approvedDate, pr.rejectedDate, pr.requestedDate) DESC
                    `, prStatus);
                    (prs || []).forEach(r => {
                        const isApproved = r.status === 'APPROVED';
                        items.push({
                            type: 'purchase_request',
                            status: r.status,
                            id: r.id,
                            reference: r.reference || 'PR-' + r.id,
                            description: (r.productName || r.productSku || '') + ' · Qty ' + (r.quantity || 0),
                            requestedByName: r.requestedByName || '—',
                            date: r.createdAt,
                            resolvedBy: isApproved ? (r.approvedByName || '—') : (r.rejectedByName || '—'),
                            resolvedAt: isApproved ? r.approvedDate : r.rejectedDate,
                            reason: isApproved ? '' : (r.rejectReason || ''),
                            productName: r.productName,
                            quantity: r.quantity
                        });
                    });
                } else if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
            }
            }

            if (!wantRejectedOnly) {
                try {
                    const [rfqs] = await db.execute(`
                        SELECT r.rfqId as id, r.rfqNumber as reference, r.withdrawal_reason, r.withdrawal_requested_at as createdAt,
                            r.withdrawal_approved_by, r.withdrawal_approved_at,
                            u1.name as requestedByName, u2.name as approvedByName,
                            p.name as productName, p.sku as productSku
                        FROM rfqs r
                        INNER JOIN purchase_requests pr ON r.purchaseRequestId = pr.requestId
                        INNER JOIN products p ON pr.productId = p.productId
                        LEFT JOIN users u1 ON r.withdrawal_requested_by = u1.userId
                        LEFT JOIN users u2 ON r.withdrawal_approved_by = u2.userId
                        WHERE r.status = 'WITHDRAWN'
                        ORDER BY r.withdrawal_approved_at DESC
                    `);
                    (rfqs || []).forEach(r => {
                        items.push({
                            type: 'rfq_withdrawal',
                            status: 'APPROVED',
                            id: r.id,
                            reference: r.reference || 'RFQ-' + r.id,
                            description: (r.productName || r.productSku || '') + (r.withdrawal_reason ? ' · ' + String(r.withdrawal_reason).slice(0, 80) : ''),
                            requestedByName: r.requestedByName || '—',
                            date: r.createdAt,
                            resolvedBy: r.approvedByName || '—',
                            resolvedAt: r.withdrawal_approved_at,
                            reason: '',
                            productName: r.productName,
                            withdrawalReason: r.withdrawal_reason
                        });
                    });
                } catch (e) {
                    if (e.code !== 'ER_NO_SUCH_TABLE' && e.code !== 'ER_BAD_FIELD_ERROR') throw e;
                }
            }
        }

        // Sort by date descending (use resolvedAt for processed, date for pending)
        items.sort((a, b) => {
            const da = a.resolvedAt || a.date || 0;
            const db2 = b.resolvedAt || b.date || 0;
            return new Date(db2) - new Date(da);
        });

        res.json({ success: true, count: items.length, data: items });
    } catch (error) {
        console.error('Error fetching all approvals:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
