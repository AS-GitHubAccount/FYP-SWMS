/**
 * Audit Log API Routes
 * 
 * Handles viewing audit logs (change history)
 */

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { logAudit, getClientIp, getUserAgent } = require('../utils/auditLogger');

// ============================================
// POST QR SCAN AUDIT (log when user scans QR for an action)
// ============================================
router.post('/qr-scan', async (req, res) => {
    try {
        const { productId, batchId, actionType } = req.body;
        const userId = req.user && req.user.userId;
        const userName = (req.user && req.user.name) || (req.user && req.user.email) || null;
        const pid = productId != null ? parseInt(productId, 10) : null;
        if (!pid || !actionType) {
            return res.status(400).json({ success: false, error: 'productId and actionType required' });
        }
        const action = String(actionType).toUpperCase().replace(/\s+/g, '_');
        const summary = `QR Scan: Product ${pid} processed for ${action} by User ${userId || 'Unknown'}`;
        await logAudit({
            tableName: 'qr_scan',
            recordId: pid,
            action: 'QR_SCAN',
            userId,
            userName,
            oldValues: null,
            newValues: { summary, actionType: action, productId: pid, batchId: batchId != null ? parseInt(batchId, 10) : null },
            ipAddress: getClientIp(req),
            userAgent: getUserAgent(req)
        });
        res.json({ success: true, message: 'QR scan logged' });
    } catch (err) {
        console.error('Error logging QR scan:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// POST QR GENERATE AUDIT (log when user generates QR - e.g. client-side fallback)
// ============================================
router.post('/qr-generate', async (req, res) => {
    try {
        const { productId, batchId } = req.body;
        const pid = productId != null ? parseInt(productId, 10) : null;
        if (!pid) {
            return res.status(400).json({ success: false, error: 'productId required' });
        }
        const bid = batchId != null ? parseInt(batchId, 10) : null;
        const summary = `QR Generate: Product ${pid}${bid ? ` Batch ${bid}` : ''} by User ${req.user && req.user.userId || 'Unknown'}`;
        await logAudit({
            tableName: 'qr_generate',
            recordId: pid,
            action: 'QR_GENERATE',
            userId: req.user && req.user.userId,
            userName: (req.user && req.user.name) || (req.user && req.user.email) || null,
            oldValues: null,
            newValues: { summary, productId: pid, batchId: bid, scope: bid ? 'batch' : 'product' },
            ipAddress: getClientIp(req),
            userAgent: getUserAgent(req)
        });
        res.json({ success: true, message: 'QR generate logged' });
    } catch (err) {
        console.error('Error logging QR generate:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// GET AUDIT FILTER OPTIONS (dynamic from database)
// ============================================
router.get('/filters', async (req, res) => {
    try {
        const [tables] = await db.execute(`
            SELECT DISTINCT tableName AS value FROM audit_log
            WHERE tableName IS NOT NULL AND TRIM(tableName) != ''
            ORDER BY tableName
        `);
        const [actions] = await db.execute(`
            SELECT DISTINCT action AS value FROM audit_log
            WHERE action IS NOT NULL AND TRIM(action) != ''
            ORDER BY action
        `);
        const [users] = await db.execute(`
            SELECT DISTINCT a.userId, u.name AS userName
            FROM audit_log a
            LEFT JOIN users u ON a.userId = u.userId
            WHERE a.userId IS NOT NULL
            ORDER BY u.name, a.userId
        `);
        res.json({
            success: true,
            data: {
                tables: (tables || []).map(t => t.value),
                actions: (actions || []).map(a => a.value),
                users: (users || []).map(u => ({ userId: u.userId, userName: u.userName || 'User #' + u.userId }))
            }
        });
    } catch (e) {
        if (e.code === 'ER_NO_SUCH_TABLE') return res.json({ success: true, data: { tables: [], actions: [], users: [] } });
        console.error('Error fetching audit filters:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ============================================
// GET ALL AUDIT LOGS
// ============================================
router.get('/', async (req, res) => {
    try {
        const { tableName, recordId, action, userId, limit = 100, offset = 0 } = req.query;
        
        let query = `
            SELECT 
                a.*,
                u.name as userName
            FROM audit_log a
            LEFT JOIN users u ON a.userId = u.userId
            WHERE 1=1
        `;
        const params = [];
        
        if (tableName) {
            query += ' AND a.tableName = ?';
            params.push(tableName);
        }
        
        if (recordId) {
            query += ' AND a.recordId = ?';
            params.push(parseInt(recordId));
        }
        
        if (action) {
            query += ' AND a.action = ?';
            params.push(action.toUpperCase());
        }
        
        if (userId) {
            query += ' AND a.userId = ?';
            params.push(parseInt(userId));
        }
        
        query += ' ORDER BY a.createdAt DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const [logs] = await db.execute(query, params);
        
        // Parse JSON fields
        const formattedLogs = logs.map(log => ({
            ...log,
            oldValues: log.oldValues ? JSON.parse(log.oldValues) : null,
            newValues: log.newValues ? JSON.parse(log.newValues) : null
        }));
        
        res.json({
            success: true,
            count: formattedLogs.length,
            data: formattedLogs
        });
    } catch (error) {
        if (error.code === 'ER_NO_SUCH_TABLE') {
            return res.json({ success: true, count: 0, data: [] });
        }
        console.error('Error fetching audit logs:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch audit logs',
            message: error.message
        });
    }
});

// ============================================
// GET AUDIT LOGS FOR SPECIFIC RECORD
// ============================================
router.get('/record/:tableName/:recordId', async (req, res) => {
    try {
        const { tableName, recordId } = req.params;
        
        const [logs] = await db.execute(
            `SELECT 
                a.*,
                u.name as userName
            FROM audit_log a
            LEFT JOIN users u ON a.userId = u.userId
            WHERE a.tableName = ? AND a.recordId = ?
            ORDER BY a.createdAt DESC`,
            [tableName, parseInt(recordId)]
        );
        
        // Parse JSON fields
        const formattedLogs = logs.map(log => ({
            ...log,
            oldValues: log.oldValues ? JSON.parse(log.oldValues) : null,
            newValues: log.newValues ? JSON.parse(log.newValues) : null
        }));
        
        res.json({
            success: true,
            count: formattedLogs.length,
            data: formattedLogs
        });
    } catch (error) {
        if (error.code === 'ER_NO_SUCH_TABLE') {
            return res.json({ success: true, count: 0, data: [] });
        }
        console.error('Error fetching audit logs for record:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch audit logs',
            message: error.message
        });
    }
});

module.exports = router;





