/**
 * RFQ (Request for Quotation) API Routes
 * Flow: PR (approved) → RFQ → Quotations → Award → PO
 */

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { generateRfqNumber } = require('../utils/idGenerator');
const { sendEmailWithResult, isOutboundEmailConfigured } = require('../utils/emailService');
const { requireCriticalApproval } = require('../utils/criticalApproval');
const { notifyAdmins } = require('../utils/notificationHelper');
const { getProductPriceBenchmark } = require('../utils/priceHistoryQueries');

// GET all RFQs
router.get('/', async (req, res) => {
    try {
        const { status } = req.query;
        let q = `
            SELECT r.*, pr.requestNumber, pr.productId, pr.quantity, p.name as productName, p.sku as productSku,
                u.name as createdByName
            FROM rfqs r
            INNER JOIN purchase_requests pr ON r.purchaseRequestId = pr.requestId
            INNER JOIN products p ON pr.productId = p.productId
            LEFT JOIN users u ON r.createdBy = u.userId
            WHERE 1=1
        `;
        const params = [];
        if (status) {
            q += ' AND r.status = ?';
            params.push(status.toUpperCase());
        }
        q += ' ORDER BY r.createdAt DESC';
        const [rows] = await db.execute(q, params);
        res.json({ success: true, count: rows.length, data: rows });
    } catch (err) {
        console.error('GET /rfqs:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET single RFQ with quotations
router.get('/:id', async (req, res) => {
    try {
        const rfqId = req.params.id;
        // LEFT JOIN PR/product so RFQ row still loads if product/PR was removed or mismatched (avoids false "not found")
        const [rfqs] = await db.execute(`
            SELECT r.*, pr.requestNumber, pr.productId, pr.quantity, pr.neededBy, pr.notes as prNotes,
                p.name as productName, p.sku as productSku,
                u.name as createdByName
            FROM rfqs r
            LEFT JOIN purchase_requests pr ON r.purchaseRequestId = pr.requestId
            LEFT JOIN products p ON pr.productId = p.productId
            LEFT JOIN users u ON r.createdBy = u.userId
            WHERE r.rfqId = ?
        `, [rfqId]);
        if (rfqs.length === 0) {
            return res.status(404).json({ success: false, error: 'RFQ not found' });
        }
        const [quotations] = await db.execute(`
            SELECT q.*, s.name as supplierName, s.email as supplierEmail
            FROM quotations q
            INNER JOIN suppliers s ON q.supplierId = s.supplierId
            WHERE q.rfqId = ?
        `, [rfqId]);
        const [suppliers] = await db.execute(`
            SELECT rs.supplierId, s.name as supplierName, s.email as supplierEmail
            FROM rfq_suppliers rs
            INNER JOIN suppliers s ON rs.supplierId = s.supplierId
            WHERE rs.rfqId = ?
        `, [rfqId]);
        const supplierEmails = (suppliers || []).map(s => s.supplierEmail).filter(Boolean);
        res.json({ success: true, data: { ...rfqs[0], quotations, suppliers, supplierEmails } });
    } catch (err) {
        console.error('GET /rfqs/:id:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST create RFQ from approved purchase request
router.post('/', async (req, res) => {
    try {
        const { purchaseRequestId, quoteDueDate, supplierIds, notes, createdBy } = req.body;
        if (!purchaseRequestId) {
            return res.status(400).json({ success: false, error: 'purchaseRequestId required' });
        }
        const [prs] = await db.execute(
            'SELECT * FROM purchase_requests WHERE requestId = ? AND status = ?',
            [purchaseRequestId, 'APPROVED']
        );
        if (prs.length === 0) {
            return res.status(400).json({ success: false, error: 'Purchase request not found or not approved' });
        }

        const [existing] = await db.execute(
            'SELECT rfqId FROM rfqs WHERE purchaseRequestId = ?',
            [purchaseRequestId]
        );
        if (existing.length > 0) {
            return res.status(400).json({ success: false, error: 'RFQ already exists for this purchase request' });
        }

        const rfqNumber = await generateRfqNumber();
        const [res1] = await db.execute(
            `INSERT INTO rfqs (rfqNumber, purchaseRequestId, status, quoteDueDate, notes, createdBy)
             VALUES (?, ?, 'DRAFT', ?, ?, ?)`,
            [rfqNumber, purchaseRequestId, quoteDueDate || null, notes || null, createdBy || null]
        );
        const rfqId = res1.insertId;

        const supplierList = Array.isArray(supplierIds) ? supplierIds : (supplierIds ? [supplierIds] : []);
        for (const sid of supplierList) {
            if (sid) {
                await db.execute(
                    'INSERT IGNORE INTO rfq_suppliers (rfqId, supplierId) VALUES (?, ?)',
                    [rfqId, parseInt(sid)]
                );
            }
        }

        const [newRfq] = await db.execute(`
            SELECT r.*, pr.requestNumber, pr.productId, pr.quantity, p.name as productName
            FROM rfqs r
            LEFT JOIN purchase_requests pr ON r.purchaseRequestId = pr.requestId
            LEFT JOIN products p ON pr.productId = p.productId
            WHERE r.rfqId = ?
        `, [rfqId]);

        const row = newRfq[0] || {};
        res.status(201).json({
            success: true,
            message: 'RFQ created',
            rfqId,
            data: { ...row, rfqId }
        });
    } catch (err) {
        console.error('POST /rfqs:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// PUT reject quotation (mandatory reason)
router.put('/quotations/:quotationId/reject', async (req, res) => {
    try {
        const quotationId = parseInt(req.params.quotationId, 10);
        const { resolution_notes } = req.body;
        if (!quotationId) {
            return res.status(400).json({ success: false, error: 'quotationId required' });
        }
        const [rows] = await db.execute('SELECT * FROM quotations WHERE quotationId = ?', [quotationId]);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Quotation not found' });
        }
        if (rows[0].status === 'ACCEPTED') {
            return res.status(400).json({ success: false, error: 'Cannot reject an awarded quotation' });
        }
        try {
            await db.execute(
                'UPDATE quotations SET status = ?, resolution_notes = ? WHERE quotationId = ?',
                ['REJECTED', (resolution_notes && String(resolution_notes).trim()) || null, quotationId]
            );
        } catch (colErr) {
            if (colErr.code === 'ER_BAD_FIELD_ERROR' && colErr.message && colErr.message.includes('resolution_notes')) {
                await db.execute('UPDATE quotations SET status = ? WHERE quotationId = ?', ['REJECTED', quotationId]);
            } else throw colErr;
        }
        res.json({ success: true, message: 'Quotation rejected' });
    } catch (err) {
        console.error('PUT /rfqs/quotations/:id/reject:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET quotations for RFQ
router.get('/:id/quotations', async (req, res) => {
    try {
        const rfqId = req.params.id;
        const [rows] = await db.execute(`
            SELECT q.*, s.name as supplierName, s.email as supplierEmail
            FROM quotations q
            INNER JOIN suppliers s ON q.supplierId = s.supplierId
            WHERE q.rfqId = ?
        `, [rfqId]);
        res.json({ success: true, count: rows.length, data: rows });
    } catch (err) {
        console.error('GET /rfqs/:id/quotations:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST add quotation to RFQ
router.post('/:id/quotations', async (req, res) => {
    try {
        const rfqId = req.params.id;
        const { supplierId, unitPrice, totalAmount, deliveryDate, validUntil, currency, notes, createdBy } = req.body;
        if (!supplierId || unitPrice == null || totalAmount == null) {
            return res.status(400).json({ success: false, error: 'supplierId, unitPrice, totalAmount required' });
        }
        const [rfqs] = await db.execute('SELECT * FROM rfqs WHERE rfqId = ?', [rfqId]);
        if (rfqs.length === 0) {
            return res.status(404).json({ success: false, error: 'RFQ not found' });
        }
        const total = parseFloat(totalAmount);
        const unit = parseFloat(unitPrice);
        await db.execute(
            `INSERT INTO quotations (rfqId, supplierId, unitPrice, totalAmount, deliveryDate, validUntil, currency, notes, createdBy)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE unitPrice=VALUES(unitPrice), totalAmount=VALUES(totalAmount),
                deliveryDate=VALUES(deliveryDate), validUntil=VALUES(validUntil), notes=VALUES(notes)`,
            [rfqId, supplierId, unit, total, deliveryDate || null, validUntil || null, currency || 'USD', notes || null, createdBy || null]
        );
        await db.execute(
            'UPDATE rfqs SET status = ? WHERE rfqId = ? AND status IN (\'DRAFT\',\'SENT\')',
            ['QUOTES_RECEIVED', rfqId]
        );
        const [rows] = await db.execute(`
            SELECT q.*, s.name as supplierName FROM quotations q
            INNER JOIN suppliers s ON q.supplierId = s.supplierId
            WHERE q.rfqId = ?
        `, [rfqId]);

        // Price intelligence notification (inbox + badge) with variance vs history
        try {
            const [metaRows] = await db.execute(
                `
                SELECT r.rfqNumber, pr.productId, p.name AS productName
                FROM rfqs r
                INNER JOIN purchase_requests pr ON r.purchaseRequestId = pr.requestId
                INNER JOIN products p ON pr.productId = p.productId
                WHERE r.rfqId = ?
                `,
                [rfqId]
            );
            const meta = metaRows[0];
            const quoteRow = rows.find((q) => String(q.supplierId) === String(supplierId));
            const supplierLabel = quoteRow?.supplierName || 'Supplier';
            const productName = meta?.productName || 'Product';
            const rfqLabel = meta?.rfqNumber || `RFQ ${rfqId}`;
            const pid = meta?.productId;
            let msg = `New quote: $${parseFloat(unitPrice).toFixed(2)} from ${supplierLabel} — ${productName} (${rfqLabel}).`;
            if (pid) {
                const bench = await getProductPriceBenchmark(pid);
                if (bench.avg12 != null && bench.avg12 > 0) {
                    const pct = ((parseFloat(unitPrice) - bench.avg12) / bench.avg12) * 100;
                    if (pct > 10) {
                        msg += ` ${pct.toFixed(1)}% above 12-mo avg ($${bench.avg12.toFixed(2)}) — high vs history.`;
                    } else if (pct < -10) {
                        msg += ` ${Math.abs(pct).toFixed(1)}% below 12-mo avg ($${bench.avg12.toFixed(2)}) — strong vs history.`;
                    } else {
                        msg += ` Within ±10% of 12-mo avg ($${bench.avg12.toFixed(2)}).`;
                    }
                }
                if (bench.lastPrice != null && bench.lastPrice > 0) {
                    const vLast = ((parseFloat(unitPrice) - bench.lastPrice) / bench.lastPrice) * 100;
                    msg += ` Last paid: $${bench.lastPrice.toFixed(2)} (${vLast >= 0 ? '+' : ''}${vLast.toFixed(1)}% vs last).`;
                }
                if (!bench.count12 && bench.lastPrice == null) {
                    msg += ' No price history yet — mark POs as Complete to build benchmarks.';
                }
            }
            await notifyAdmins(msg, {
                triggeredBy: createdBy || null,
                notifyCreatorUserId: rfqs[0].createdBy != null ? rfqs[0].createdBy : null,
                relatedEntityType: 'rfq',
                relatedEntityId: parseInt(rfqId, 10),
                notificationType: 'INFO'
            });
        } catch (notifyErr) {
            console.error('[rfqs] quote notification:', notifyErr.message);
        }

        res.status(201).json({ success: true, data: rows });
    } catch (err) {
        console.error('POST /rfqs/:id/quotations:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Format date for emails: "16 Mar 2026 11:45"
function formatRfqDate(d) {
    if (!d) return '';
    const x = new Date(d);
    const day = x.getDate();
    const month = x.toLocaleString('en-GB', { month: 'short' });
    const year = x.getFullYear();
    const h = x.getHours();
    const m = x.getMinutes();
    return `${day} ${month} ${year} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// POST send RFQ email (Review Email flow - human-in-the-loop); store snapshot for read-only view
router.post('/:id/send-email', async (req, res) => {
    try {
        const rfqId = req.params.id;
        const { to, cc, bcc, replyTo, subject, body, html } = req.body;
        if (!to || !subject || (!body && !html)) {
            return res.status(400).json({ success: false, error: 'to, subject, and body (or html) required' });
        }
        const [rfqs] = await db.execute(`
            SELECT r.*, pr.requestNumber, pr.productId, pr.quantity, p.name as productName, p.sku as productSku
            FROM rfqs r
            LEFT JOIN purchase_requests pr ON r.purchaseRequestId = pr.requestId
            LEFT JOIN products p ON pr.productId = p.productId
            WHERE r.rfqId = ?
        `, [rfqId]);
        if (rfqs.length === 0) {
            return res.status(404).json({ success: false, error: 'RFQ not found' });
        }
        const rfq = rfqs[0];
        const htmlBody = (html && typeof html === 'string') ? html : (body || '').replace(/\n/g, '<br>');
        const textFallback = (body && typeof body === 'string') ? body.replace(/<[^>]+>/g, '') : htmlBody.replace(/<[^>]+>/g, '');
        if (!isOutboundEmailConfigured()) {
            return res.status(503).json({
                success: false,
                error:
                    'Email is not configured. On Railway Free/Hobby, SMTP is often blocked — add RESEND_API_KEY and RESEND_FROM (see .env.example). Alternatively set SMTP_USER + SMTP_PASS for SMTP where outbound 465/587 is allowed.'
            });
        }
        const sendResult = await sendEmailWithResult({
            to: to.trim(),
            cc: (cc || '').trim() || undefined,
            bcc: (bcc || '').trim() || undefined,
            replyTo: (replyTo && String(replyTo).trim()) || undefined,
            subject: subject.trim(),
            html: htmlBody,
            text: textFallback
        });
        if (!sendResult.ok) {
            return res.status(500).json({
                success: false,
                error: sendResult.userMessage || 'Email could not be sent.',
                detail: process.env.NODE_ENV !== 'production' ? sendResult.raw : undefined
            });
        }
        const now = new Date();
        const toVal = (to || '').trim();
        const ccVal = (cc || '').trim() || null;
        const bccVal = (bcc || '').trim() || null;
        const subjVal = (subject || '').trim() || null;
        try {
            await db.execute(
                `UPDATE rfqs SET status = ?, last_sent_at = ?, last_sent_to = ?, last_sent_cc = ?, last_sent_bcc = ?, last_sent_subject = ?, last_sent_body = ? WHERE rfqId = ?`,
                ['SENT', now, toVal, ccVal, bccVal, subjVal, htmlBody, rfqId]
            );
        } catch (updErr) {
            if (updErr.code === 'ER_BAD_FIELD_ERROR') {
                console.warn('[rfqs] send-email: last_sent_* columns missing; run backend ensurePurchasingTables. Status set to SENT without snapshot.');
                await db.execute(`UPDATE rfqs SET status = 'SENT' WHERE rfqId = ?`, [rfqId]);
            } else {
                throw updErr;
            }
        }
        res.json({ success: true, message: 'RFQ email sent', data: { rfqId, status: 'SENT' } });
    } catch (err) {
        console.error('POST /rfqs/:id/send-email:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// PUT request withdrawal (sets WITHDRAW_PENDING; requires reason)
router.put('/:id/request-withdrawal', async (req, res) => {
    try {
        const rfqId = req.params.id;
        const { reason, requestedBy } = req.body;
        const r = (reason && String(reason).trim()) || null;
        if (!r) {
            return res.status(400).json({ success: false, error: 'Reason for withdrawal is required' });
        }
        const [rows] = await db.execute('SELECT rfqId, status FROM rfqs WHERE rfqId = ?', [rfqId]);
        if (rows.length === 0) return res.status(404).json({ success: false, error: 'RFQ not found' });
        if (rows[0].status !== 'SENT') {
            return res.status(400).json({ success: false, error: 'Only sent RFQs can be withdrawn' });
        }
        await db.execute(
            `UPDATE rfqs SET status = 'WITHDRAW_PENDING', withdrawal_reason = ?, withdrawal_requested_at = NOW(), withdrawal_requested_by = ? WHERE rfqId = ?`,
            [r, requestedBy || null, rfqId]
        );
        res.json({ success: true, message: 'Withdrawal requested (pending admin approval)', data: { rfqId, status: 'WITHDRAW_PENDING' } });
    } catch (err) {
        console.error('PUT /rfqs/:id/request-withdrawal:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// PUT approve withdrawal (admin); verification + optional approval token; sends withdrawal email, sets WITHDRAWN
router.put('/:id/approve-withdrawal', async (req, res) => {
    try {
        const approvalCheck = await requireCriticalApproval(req, res, 'approve_withdrawal');
        if (approvalCheck) return;

        const rfqId = req.params.id;
        const { approvedBy } = req.body;
        const [rows] = await db.execute(`
            SELECT r.*, pr.productId, p.name as productName, p.sku as productSku,
                r.last_sent_to, r.last_sent_cc, r.last_sent_bcc, r.last_sent_at
            FROM rfqs r
            INNER JOIN purchase_requests pr ON r.purchaseRequestId = pr.requestId
            INNER JOIN products p ON pr.productId = p.productId
            WHERE r.rfqId = ?
        `, [rfqId]);
        if (rows.length === 0) return res.status(404).json({ success: false, error: 'RFQ not found' });
        if (rows[0].status !== 'WITHDRAW_PENDING') {
            return res.status(400).json({ success: false, error: 'RFQ is not pending withdrawal' });
        }
        const rfq = rows[0];
        const productLabel = [rfq.productSku, rfq.productName].filter(Boolean).join(' - ') || 'Item';
        const originalSendDate = formatRfqDate(rfq.last_sent_at);
        const [users] = await db.execute('SELECT name FROM users WHERE userId = ?', [approvedBy || rfq.createdBy]);
        const senderName = (users && users[0] && users[0].name && String(users[0].name).trim()) ? users[0].name.trim() : 'SWMS';
        const withdrawalBody = `Dear Supplier,

I regret to inform you that we must withdraw the RFQ for ${productLabel} that was sent on ${originalSendDate}.

We apologize for any inconvenience this may cause and want to express our gratitude for your understanding in this matter. Maintaining a positive relationship with your company is important to us.

Thank you for your attention to this issue.

Best regards,
${senderName}
Smart Warehouse Management`;
        const toList = (rfq.last_sent_to || '').trim();
        const ccList = (rfq.last_sent_cc || '').trim() || undefined;
        const bccList = (rfq.last_sent_bcc || '').trim() || undefined;
        if (toList) {
            const wr = await sendEmailWithResult({
                to: toList,
                cc: ccList,
                bcc: bccList,
                subject: `Withdrawal of RFQ - ${rfq.productName || rfq.productSku || 'Request'}`,
                html: withdrawalBody.replace(/\n/g, '<br>'),
                text: withdrawalBody
            });
            if (!wr.ok) {
                return res.status(500).json({
                    success: false,
                    error: wr.userMessage || 'Withdrawal email could not be sent.'
                });
            }
        }
        await db.execute(
            `UPDATE rfqs SET status = 'WITHDRAWN', withdrawal_approved_by = ?, withdrawal_approved_at = NOW() WHERE rfqId = ?`,
            [approvedBy || null, rfqId]
        );
        res.json({ success: true, message: 'Withdrawal approved and notification sent', data: { rfqId, status: 'WITHDRAWN' } });
    } catch (err) {
        console.error('PUT /rfqs/:id/approve-withdrawal:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// PUT reject withdrawal (admin); reverts WITHDRAW_PENDING back to SENT
router.put('/:id/reject-withdrawal', async (req, res) => {
    try {
        const rfqId = req.params.id;
        const { rejectedBy, rejectReason } = req.body;
        const [rows] = await db.execute('SELECT rfqId, status FROM rfqs WHERE rfqId = ?', [rfqId]);
        if (rows.length === 0) return res.status(404).json({ success: false, error: 'RFQ not found' });
        if (rows[0].status !== 'WITHDRAW_PENDING') {
            return res.status(400).json({ success: false, error: 'RFQ is not pending withdrawal' });
        }
        try {
            await db.execute(
                `UPDATE rfqs SET status = 'SENT', withdrawal_reason = NULL, withdrawal_requested_at = NULL, withdrawal_requested_by = NULL WHERE rfqId = ?`,
                [rfqId]
            );
        } catch (colErr) {
            if (colErr.code === 'ER_BAD_FIELD_ERROR') {
                await db.execute(`UPDATE rfqs SET status = 'SENT' WHERE rfqId = ?`, [rfqId]);
            } else throw colErr;
        }
        res.json({ success: true, message: 'Withdrawal request rejected; RFQ remains active', data: { rfqId, status: 'SENT' } });
    } catch (err) {
        console.error('PUT /rfqs/:id/reject-withdrawal:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
