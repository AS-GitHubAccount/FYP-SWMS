/**
 * Dashboard analytics API
 * GET /api/dashboard/stats - Total stock, low stock, out of stock, active alerts, maintenance due
 * GET /api/dashboard/operations - Recent receiving/issuing (ID sort descending)
 * GET /api/dashboard/distribution - Stock by category (pie/donut)
 * GET /api/dashboard/movement - Monthly inbound/outbound (last 6 months)
 */

const express = require('express');
const router = express.Router();
const db = require('../config/database');

const CACHE_MS = 60 * 60 * 1000; // 1 hour
let distributionCache = null;
let distributionCacheTime = 0;
let movementCache = null;
let movementCacheTime = 0;

// GET /api/dashboard/stats - Counts for stats cards
router.get('/stats', async (req, res) => {
    try {
        const [invRows] = await db.execute(`
            SELECT
                COALESCE(SUM(i.totalQty), 0) AS totalStock,
                SUM(CASE WHEN (i.totalQty > 0 AND i.totalQty <= COALESCE(p.minStock, 0)) THEN 1 ELSE 0 END) AS lowStockCount,
                SUM(CASE WHEN COALESCE(i.totalQty, 0) = 0 THEN 1 ELSE 0 END) AS outOfStockCount
            FROM inventory_items i
            INNER JOIN products p ON i.productId = p.productId
        `);
        const [alertRows] = await db.execute(
            'SELECT COUNT(*) AS activeAlerts FROM alerts WHERE resolved = FALSE'
        );
        const todayStr = new Date().toISOString().slice(0, 10);
        const sevenDaysLater = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const [maintRows] = await db.execute(`
            SELECT COUNT(*) AS maintenanceDue
            FROM batches b
            INNER JOIN products p ON b.productId = p.productId
            WHERE b.nextMaintenanceDue IS NOT NULL
              AND b.nextMaintenanceDue >= ?
              AND b.nextMaintenanceDue <= ?
              AND COALESCE(b.quantity, 0) > 0
              AND (p.productType = 'EQUIPMENT' OR p.productType = 'GOODS_WITH_SERVICE'
                   OR LOWER(COALESCE(p.category, '')) LIKE '%it%' OR LOWER(COALESCE(p.category, '')) LIKE '%asset%')
        `, [todayStr, sevenDaysLater]);

        const row = invRows && invRows[0] ? invRows[0] : {};
        const payload = {
            success: true,
            data: {
                totalStock: Number(row.totalStock) || 0,
                lowStockCount: Number(row.lowStockCount) || 0,
                outOfStockCount: Number(row.outOfStockCount) || 0,
                activeAlerts: Number(alertRows && alertRows[0] && alertRows[0].activeAlerts) || 0,
                maintenanceDueCount: Number(maintRows && maintRows[0] && maintRows[0].maintenanceDue) || 0
            }
        };
        res.json(payload);
    } catch (err) {
        console.error('GET /dashboard/stats:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/dashboard/operations - Recent in/out records, newest first (ID sort descending)
router.get('/operations', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
        const [inRows] = await db.execute(`
            SELECT
                ir.recordId AS id,
                ir.receivedDate AS date,
                'Received' AS type,
                p.name AS productName,
                ir.quantity,
                ir.receivedBy AS userName
            FROM in_records ir
            INNER JOIN products p ON ir.productId = p.productId
            ORDER BY ir.receivedDate DESC, ir.recordId DESC
            LIMIT ?
        `, [limit]);
        const [outRows] = await db.execute(`
            SELECT
                o.recordId AS id,
                o.issuedDate AS date,
                'Issued' AS type,
                p.name AS productName,
                o.quantity,
                o.issuedBy AS userName
            FROM out_records o
            INNER JOIN products p ON o.productId = p.productId
            ORDER BY o.issuedDate DESC, o.recordId DESC
            LIMIT ?
        `, [limit]);

        const combined = [
            ...(inRows || []).map(r => ({ ...r, sortDate: new Date(r.date), sortId: r.id })),
            ...(outRows || []).map(r => ({ ...r, sortDate: new Date(r.date), sortId: r.id }))
        ].sort((a, b) => {
            const d = b.sortDate - a.sortDate;
            return d !== 0 ? d : (b.sortId - a.sortId);
        }).slice(0, limit).map(r => ({
            id: r.id,
            date: r.date,
            type: r.type,
            productName: r.productName || 'N/A',
            quantity: Number(r.quantity) || 0,
            userName: r.userName || 'N/A'
        }));

        res.json({ success: true, data: combined, count: combined.length });
    } catch (err) {
        console.error('GET /dashboard/operations:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/dashboard/distribution - Stock by category (GROUP BY category)
router.get('/distribution', async (req, res) => {
    try {
        if (distributionCache && (Date.now() - distributionCacheTime) < CACHE_MS) {
            return res.json(distributionCache);
        }
        const [rows] = await db.execute(`
            SELECT 
                COALESCE(NULLIF(TRIM(p.category), ''), 'Uncategorised') AS category,
                COALESCE(SUM(i.totalQty), 0) AS total
            FROM inventory_items i
            INNER JOIN products p ON i.productId = p.productId
            GROUP BY COALESCE(NULLIF(TRIM(p.category), ''), 'Uncategorised')
            ORDER BY total DESC
        `);
        const labels = (rows || []).map(r => r.category);
        const values = (rows || []).map(r => Number(r.total) || 0);
        const payload = { success: true, data: { labels, values }, count: labels.length };
        distributionCache = payload;
        distributionCacheTime = Date.now();
        res.json(payload);
    } catch (err) {
        console.error('GET /dashboard/distribution:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/dashboard/movement - Last 6 months inbound vs outbound
router.get('/movement', async (req, res) => {
    try {
        if (movementCache && (Date.now() - movementCacheTime) < CACHE_MS) {
            return res.json(movementCache);
        }
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const today = new Date();
        const labels = [];
        for (let i = 5; i >= 0; i--) {
            const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
            labels.push(`${monthNames[d.getMonth()]} ${d.getFullYear()}`);
        }
        const monthKeys = [];
        for (let i = 5; i >= 0; i--) {
            const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
            monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
        }

        const sixMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 5, 1);
        const sixMonthsAgoStr = sixMonthsAgo.toISOString().slice(0, 7);

        const [inRows] = await db.execute(`
            SELECT 
                DATE_FORMAT(receivedDate, '%Y-%m') AS monthKey,
                COALESCE(SUM(quantity), 0) AS total
            FROM in_records
            WHERE receivedDate >= ?
            GROUP BY DATE_FORMAT(receivedDate, '%Y-%m')
        `, [sixMonthsAgoStr + '-01']);

        const [outRows] = await db.execute(`
            SELECT 
                DATE_FORMAT(issuedDate, '%Y-%m') AS monthKey,
                COALESCE(SUM(quantity), 0) AS total
            FROM out_records
            WHERE issuedDate >= ?
            GROUP BY DATE_FORMAT(issuedDate, '%Y-%m')
        `, [sixMonthsAgoStr + '-01']);

        const inMap = {};
        (inRows || []).forEach(r => { inMap[r.monthKey] = Number(r.total) || 0; });
        const outMap = {};
        (outRows || []).forEach(r => { outMap[r.monthKey] = Number(r.total) || 0; });

        const inData = monthKeys.map(k => inMap[k] || 0);
        const outData = monthKeys.map(k => outMap[k] || 0);

        const payload = {
            success: true,
            data: {
                labels,
                in: inData,
                out: outData
            }
        };
        movementCache = payload;
        movementCacheTime = Date.now();
        res.json(payload);
    } catch (err) {
        console.error('GET /dashboard/movement:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
