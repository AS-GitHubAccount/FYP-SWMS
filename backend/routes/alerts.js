/**
 * Alerts API Routes
 * 
 * Handles alert-related endpoints:
 * - GET /api/alerts - Get all alerts
 * - GET /api/alerts/:id - Get single alert
 * - POST /api/alerts - Create alert
 * - PUT /api/alerts/:id/resolve - Resolve alert
 * - DELETE /api/alerts/:id - Delete alert
 */

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { notifyAdmins } = require('../utils/notificationHelper');
const { checkAllProducts, autoResolveAlerts } = require('../utils/alertChecker');

router.get('/check', async (req, res) => {
    try {
        await checkAllProducts();
        await autoResolveAlerts();
        const [rows] = await db.execute(
            'SELECT COUNT(*) as active FROM alerts WHERE resolved = FALSE'
        );
        res.json({
            success: true,
            message: 'Alert check completed',
            activeAlerts: rows[0].active
        });
    } catch (error) {
        console.error('Error running alert check:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to run alert check',
            message: error.message
        });
    }
});

router.get('/', async (req, res) => {
    try {
        const { resolved, alertType, severity } = req.query;
        
        let query = `
            SELECT 
                a.*,
                p.name as productName,
                p.sku as productSku,
                b.lotCode,
                u.name as resolvedByName
            FROM alerts a
            LEFT JOIN products p ON a.productId = p.productId
            LEFT JOIN batches b ON a.batchId = b.batchId
            LEFT JOIN users u ON a.resolvedBy = u.userId
            WHERE 1=1
        `;
        const params = [];
        
        if (resolved !== undefined) {
            query += ` AND a.resolved = ?`;
            params.push(resolved === 'true' ? 1 : 0);
        }
        
        if (alertType) {
            query += ` AND a.alertType = ?`;
            params.push(alertType);
        }
        
        if (severity) {
            query += ` AND a.severity = ?`;
            params.push(severity);
        }
        
        query += ` ORDER BY a.alertId ASC`;
        
        const [alerts] = await db.execute(query, params);
        
        res.json({
            success: true,
            count: alerts.length,
            data: alerts
        });
    } catch (error) {
        console.error('Error fetching alerts:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to fetch alerts',
            message: error.message 
        });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const alertId = req.params.id;
        
        const [alerts] = await db.execute(`
            SELECT 
                a.*,
                p.name as productName,
                p.sku as productSku,
                b.lotCode,
                u.name as resolvedByName
            FROM alerts a
            LEFT JOIN products p ON a.productId = p.productId
            LEFT JOIN batches b ON a.batchId = b.batchId
            LEFT JOIN users u ON a.resolvedBy = u.userId
            WHERE a.alertId = ?
        `, [alertId]);
        
        if (alerts.length === 0) {
            return res.status(404).json({ 
                success: false,
                error: 'Alert not found' 
            });
        }
        
        res.json({
            success: true,
            data: alerts[0]
        });
    } catch (error) {
        console.error('Error fetching alert:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to fetch alert',
            message: error.message 
        });
    }
});

router.post('/', async (req, res) => {
    try {
        const { alertType, severity, productId, batchId, message } = req.body;
        
        if (!alertType || !message) {
            return res.status(400).json({
                success: false,
                error: 'alertType and message are required'
            });
        }
        
        const [result] = await db.execute(
            `INSERT INTO alerts (alertType, severity, productId, batchId, message)
             VALUES (?, ?, ?, ?, ?)`,
            [
                alertType,
                severity || 'WARN',
                productId || null,
                batchId || null,
                message
            ]
        );
        
        const [newAlert] = await db.execute(
            'SELECT * FROM alerts WHERE alertId = ?',
            [result.insertId]
        );
        
        await notifyAdmins(
            `Alert: ${message}`,
            { triggeredBy: 1, notificationType: severity === 'CRITICAL' ? 'WARNING' : 'INFO', relatedEntityType: 'alert', relatedEntityId: result.insertId, sendEmail: severity === 'CRITICAL', emailSubject: 'Critical Alert' }
        );
        
        res.status(201).json({
            success: true,
            message: 'Alert created successfully',
            data: newAlert[0]
        });
    } catch (error) {
        console.error('Error creating alert:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to create alert',
            message: error.message 
        });
    }
});

router.put('/:id/resolve', async (req, res) => {
    try {
        const alertId = req.params.id;
        const { resolvedBy, resolution_notes } = req.body;
        
        const [existing] = await db.execute(
            'SELECT * FROM alerts WHERE alertId = ?',
            [alertId]
        );
        
        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Alert not found'
            });
        }
        
        try {
            await db.execute(
                `UPDATE alerts 
                 SET resolved = TRUE,
                     resolvedBy = ?,
                     resolvedAt = CURRENT_TIMESTAMP,
                     resolution_notes = ?
                 WHERE alertId = ?`,
                [resolvedBy || null, (resolution_notes && String(resolution_notes).trim()) || null, alertId]
            );
        } catch (colErr) {
            if (colErr.code === 'ER_BAD_FIELD_ERROR' && colErr.message && colErr.message.includes('resolution_notes')) {
                await db.execute(
                    `UPDATE alerts 
                     SET resolved = TRUE,
                         resolvedBy = ?,
                         resolvedAt = CURRENT_TIMESTAMP
                     WHERE alertId = ?`,
                    [resolvedBy || null, alertId]
                );
            } else throw colErr;
        }
        
        const [updated] = await db.execute(
            'SELECT * FROM alerts WHERE alertId = ?',
            [alertId]
        );
        
        res.json({
            success: true,
            message: 'Alert resolved successfully',
            data: updated[0]
        });
    } catch (error) {
        console.error('Error resolving alert:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to resolve alert',
            message: error.message 
        });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const alertId = req.params.id;
        
        const [existing] = await db.execute(
            'SELECT * FROM alerts WHERE alertId = ?',
            [alertId]
        );
        
        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Alert not found'
            });
        }
        
        await db.execute(
            'DELETE FROM alerts WHERE alertId = ?',
            [alertId]
        );
        
        res.json({
            success: true,
            message: 'Alert deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting alert:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to delete alert',
            message: error.message 
        });
    }
});

module.exports = router;





