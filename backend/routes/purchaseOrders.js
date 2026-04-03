/**
 * Purchase Orders API Routes
 * PO created when a quotation is awarded
 */

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { notifyAdmins } = require('../utils/notificationHelper');
const { generatePoNumber } = require('../utils/idGenerator');

// GET all purchase orders
router.get('/', async (req, res) => {
    try {
        const { status } = req.query;
        let q = `
            SELECT po.*, p.name as productName, p.sku as productSku,
                s.name as supplierName, s.email as supplierEmail,
                u.name as createdByName
            FROM purchase_orders po
            INNER JOIN products p ON po.productId = p.productId
            INNER JOIN suppliers s ON po.supplierId = s.supplierId
            LEFT JOIN users u ON po.createdBy = u.userId
            WHERE 1=1
        `;
        const params = [];
        if (status) {
            q += ' AND po.status = ?';
            params.push(status.toUpperCase());
        }
        q += ' ORDER BY po.createdAt DESC';
        const [rows] = await db.execute(q, params);
        res.json({ success: true, count: rows.length, data: rows });
    } catch (err) {
        console.error('GET /purchase-orders:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET single PO by numeric poId OR by poNumber (e.g. PO-2603-0001) — used by receiving / lookups
// Returns PO for SENT, CONFIRMED, PARTIAL_RECEIVED, RECEIVED, DRAFT; excludes only CANCELLED
router.get('/:id', async (req, res) => {
    try {
        const raw = String(req.params.id || '').trim();
        if (!raw) {
            return res.status(400).json({ success: false, error: 'Invalid purchase order reference' });
        }
        const baseSql = `
            SELECT po.*, p.name as productName, p.sku as productSku,
                s.name as supplierName, s.email as supplierEmail, s.phone as supplierPhone,
                u.name as createdByName
            FROM purchase_orders po
            LEFT JOIN products p ON po.productId = p.productId
            LEFT JOIN suppliers s ON po.supplierId = s.supplierId
            LEFT JOIN users u ON po.createdBy = u.userId
            WHERE (po.status IS NULL OR po.status != 'CANCELLED')
        `;
        const numericId = /^\d+$/.test(raw) ? parseInt(raw, 10) : null;
        let rows;
        if (numericId !== null) {
            [rows] = await db.execute(
                `${baseSql} AND (po.poId = ? OR po.poNumber = ?)`,
                [numericId, raw]
            );
        } else {
            [rows] = await db.execute(
                `${baseSql} AND (po.poNumber = ? OR LOWER(TRIM(po.poNumber)) = LOWER(TRIM(?)))`,
                [raw, raw]
            );
        }
        if (rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Purchase order not found' });
        }
        const po = rows[0];
        const items = [{
            productId: po.productId,
            productName: po.productName,
            productSku: po.productSku,
            quantity: po.quantity,
            unitPrice: po.unitPrice,
            totalAmount: po.totalAmount,
            expectedDelivery: po.expectedDelivery
        }];
        res.json({ success: true, data: { ...po, items } });
    } catch (err) {
        console.error('GET /purchase-orders/:id:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST create PO from quotation (award quote)
router.post('/from-quotation', async (req, res) => {
    try {
        const { quotationId, createdBy, resolution_notes } = req.body;
        if (!quotationId) {
            return res.status(400).json({ success: false, error: 'quotationId required' });
        }
        const [quotes] = await db.execute(`
            SELECT q.*, s.name as supplierName, r.rfqId, r.purchaseRequestId
            FROM quotations q
            INNER JOIN suppliers s ON q.supplierId = s.supplierId
            INNER JOIN rfqs r ON q.rfqId = r.rfqId
            INNER JOIN purchase_requests pr ON r.purchaseRequestId = pr.requestId
            WHERE q.quotationId = ?
        `, [quotationId]);
        if (quotes.length === 0) {
            return res.status(404).json({ success: false, error: 'Quotation not found' });
        }
        const q = quotes[0];
        const [prs] = await db.execute(
            'SELECT productId, quantity FROM purchase_requests WHERE requestId = ?',
            [q.purchaseRequestId]
        );
        if (prs.length === 0) {
            return res.status(400).json({ success: false, error: 'Purchase request not found' });
        }
        const { productId, quantity } = prs[0];

        const poNumber = await generatePoNumber();
        await db.execute(
            `INSERT INTO purchase_orders (poNumber, quotationId, rfqId, purchaseRequestId, supplierId, productId, quantity, unitPrice, totalAmount, status, expectedDelivery, createdBy)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'SENT', ?, ?)`,
            [poNumber, quotationId, q.rfqId, q.purchaseRequestId, q.supplierId, productId, quantity, q.unitPrice, q.totalAmount, q.deliveryDate, createdBy || null]
        );
        try {
            await db.execute(
                'UPDATE quotations SET status = ?, resolution_notes = ? WHERE quotationId = ?',
                ['ACCEPTED', (resolution_notes && String(resolution_notes).trim()) || null, quotationId]
            );
        } catch (colErr) {
            if (colErr.code === 'ER_BAD_FIELD_ERROR' && colErr.message && colErr.message.includes('resolution_notes')) {
                await db.execute('UPDATE quotations SET status = ? WHERE quotationId = ?', ['ACCEPTED', quotationId]);
            } else throw colErr;
        }
        await db.execute(
            'UPDATE rfqs SET status = ? WHERE rfqId = ?',
            ['AWARDED', q.rfqId]
        );

        const [newPo] = await db.execute(`
            SELECT po.*, p.name as productName, s.name as supplierName
            FROM purchase_orders po
            INNER JOIN products p ON po.productId = p.productId
            INNER JOIN suppliers s ON po.supplierId = s.supplierId
            WHERE po.poNumber = ?
        `, [poNumber]);

        await notifyAdmins(`Purchase order ${poNumber} created for ${newPo[0].productName} from ${newPo[0].supplierName}`, {
            triggeredBy: createdBy,
            relatedEntityType: 'purchase_order',
            relatedEntityId: newPo[0].poId
        });

        res.status(201).json({ success: true, message: 'Purchase order created', data: newPo[0] });
    } catch (err) {
        console.error('POST /purchase-orders/from-quotation:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Mark PO complete (RECEIVED) — logs unit price to price_history once per poId
router.patch('/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const { status } = req.body || {};
        if (!id || !status) {
            return res.status(400).json({ success: false, error: 'poId and status required' });
        }
        const [rows] = await db.execute('SELECT * FROM purchase_orders WHERE poId = ?', [id]);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Purchase order not found' });
        }
        const upper = String(status).toUpperCase();
        await db.execute('UPDATE purchase_orders SET status = ? WHERE poId = ?', [upper, id]);
        if (upper === 'RECEIVED') {
            const { recordPriceHistoryFromPurchaseOrder } = require('../utils/priceHistoryQueries');
            await recordPriceHistoryFromPurchaseOrder(rows[0]);
        }
        const [updated] = await db.execute(
            `
            SELECT po.*, p.name AS productName, p.sku AS productSku,
                s.name AS supplierName, s.email AS supplierEmail
            FROM purchase_orders po
            INNER JOIN products p ON po.productId = p.productId
            INNER JOIN suppliers s ON po.supplierId = s.supplierId
            WHERE po.poId = ?
            `,
            [id]
        );
        res.json({ success: true, data: updated[0] || null });
    } catch (err) {
        console.error('PATCH /purchase-orders/:id', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
