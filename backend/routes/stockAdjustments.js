// /api/stock-adjustments
const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { checkAndCreateAlerts } = require('../utils/alertChecker');

// GET all adjustments
router.get('/', async (req, res) => {
    try {
        const { productId, adjustmentType } = req.query;
        let query = `
            SELECT sa.*, p.name as productName, p.sku, b.lotCode, u.name as adjustedByName
            FROM stock_adjustments sa
            INNER JOIN products p ON sa.productId = p.productId
            LEFT JOIN batches b ON sa.batchId = b.batchId
            LEFT JOIN users u ON sa.adjustedBy = u.userId
            WHERE 1=1
        `;
        const params = [];
        if (productId) { query += ' AND sa.productId = ?'; params.push(productId); }
        if (adjustmentType) { query += ' AND sa.adjustmentType = ?'; params.push(adjustmentType); }
        query += ' ORDER BY sa.createdAt DESC';
        const [rows] = await db.execute(query, params);
        res.json({ success: true, count: rows.length, data: rows });
    } catch (err) {
        console.error('Error fetching adjustments:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST create adjustment (quantity: positive=add, negative=subtract)
router.post('/', async (req, res) => {
    try {
        const { productId, batchId, adjustmentType, quantity, reason, adjustedBy } = req.body;
        if (!productId || !adjustmentType || quantity === undefined || quantity === null || !adjustedBy) {
            return res.status(400).json({ success: false, error: 'productId, adjustmentType, quantity, adjustedBy required' });
        }
        const qty = parseInt(quantity);
        if (isNaN(qty) || qty === 0) {
            return res.status(400).json({ success: false, error: 'quantity must be non-zero integer' });
        }
        const [inv] = await db.execute('SELECT * FROM inventory_items WHERE productId = ?', [productId]);
        if (!inv.length) {
            return res.status(404).json({ success: false, error: 'Product has no inventory record' });
        }
        if (batchId) {
            const [batches] = await db.execute('SELECT * FROM batches WHERE batchId = ? AND productId = ?', [batchId, productId]);
            if (batches.length) {
                const newBatchQty = Math.max(0, batches[0].quantity + qty);
                await db.execute('UPDATE batches SET quantity = ? WHERE batchId = ?', [newBatchQty, batchId]);
            }
        }
        await db.execute(
            'UPDATE inventory_items SET totalQty = totalQty + ?, available = GREATEST(0, available + ?) WHERE productId = ?',
            [qty, qty, productId]
        );
        const [ins] = await db.execute(
            `INSERT INTO stock_adjustments (productId, batchId, adjustmentType, quantity, reason, adjustedBy)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [productId, batchId || null, adjustmentType, qty, reason || null, adjustedBy]
        );
        checkAndCreateAlerts(productId).catch(e => console.error('alert check:', e.message));
        const [rows] = await db.execute('SELECT * FROM stock_adjustments WHERE adjustmentId = ?', [ins.insertId]);
        res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
        console.error('Error creating adjustment:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
