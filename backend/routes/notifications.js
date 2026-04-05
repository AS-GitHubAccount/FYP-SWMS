/**
 * Notifications API Routes
 * 
 * Handles user notifications:
 * - GET /api/notifications - Get all notifications for current user
 * - GET /api/notifications/unread - Get unread notifications count
 * - PUT /api/notifications/:id/read - Mark notification as read
 * - PUT /api/notifications/:id/unread - Mark notification as unread
 * - DELETE /api/notifications/:id - Delete notification
 * - PUT /api/notifications/read-all - Mark all notifications as read
 * - DELETE /api/notifications/clear-all - Delete all notifications for user
 * - POST /api/notifications - Create notification (admin/system use)
 */

const express = require('express');
const router = express.Router();
const db = require('../config/database');

function resolveNotificationUserId(req) {
    const fromQuery = parseInt(req.query.userId, 10);
    let fromToken = NaN;
    if (req.user && req.user.userId != null && req.user.userId !== '') {
        fromToken = parseInt(req.user.userId, 10);
    }
    if (!isNaN(fromToken) && fromToken > 0) return fromToken;
    if (!isNaN(fromQuery) && fromQuery > 0) return fromQuery;
    return NaN;
}

/** Normalize mysql2 row keys (some drivers/configs return lowercase columns). */
function mapNotificationRow(r) {
    if (!r || typeof r !== 'object') return r;
    const g = function pick() {
        for (let i = 0; i < arguments.length; i++) {
            const k = arguments[i];
            if (r[k] !== undefined && r[k] !== null) return r[k];
        }
        return undefined;
    };
    return Object.assign({}, r, {
        notificationId: g('notificationId', 'notificationid'),
        userId: g('userId', 'userid'),
        message: g('message') != null ? g('message') : '',
        recipient: g('recipient') != null ? g('recipient') : '',
        notificationType: g('notificationType', 'notificationtype') || 'INFO',
        type: g('type'),
        subject: g('subject'),
        relatedEntityType: g('relatedEntityType', 'relatedentitytype'),
        relatedEntityId: g('relatedEntityId', 'relatedentityid'),
        isRead: !!(g('isRead', 'isread')),
        readAt: g('readAt', 'readat'),
        createdAt: g('createdAt', 'createdat'),
        targetUrl: g('targetUrl', 'target_url', 'targeturl'),
        target_url: g('target_url', 'targetUrl', 'targeturl')
    });
}

function wantsAdminAllNotifications(req) {
    const role = (req.user && req.user.role) ? String(req.user.role).toUpperCase() : '';
    if (role !== 'ADMIN') return false;
    const q = req.query.all;
    return q === '1' || q === 'true' || q === 'yes';
}

router.get('/', async (req, res) => {
    try {
        const userId = resolveNotificationUserId(req);
        if (!userId || isNaN(userId)) {
            return res.status(400).json({
                success: false,
                error: 'User ID is required'
            });
        }

        let notifications = [];
        try {
            const adminAll = wantsAdminAllNotifications(req);
            const [rows] = adminAll
                ? await db.execute(
                    `SELECT n.*
                     FROM notifications n
                     ORDER BY n.createdAt DESC
                     LIMIT 500`
                )
                : await db.execute(
                    `SELECT n.*
                     FROM notifications n
                     WHERE n.userId = ?
                     ORDER BY n.createdAt DESC`,
                    [userId]
                );
            notifications = (rows || []).map(mapNotificationRow);
        } catch (dbErr) {
            if (dbErr.code === 'ER_NO_SUCH_TABLE') {
                return res.json({ success: true, count: 0, data: [] });
            }
            throw dbErr;
        }

        res.json({
            success: true,
            count: notifications.length,
            data: notifications
        });
    } catch (error) {
        console.error('Error fetching notifications:', error);
        // Prototype safety: never block the inbox UI because of a backend error.
        res.json({
            success: false,
            count: 0,
            data: [],
            error: 'Failed to fetch notifications',
            message: error.message
        });
    }
});

async function handleUnreadCount(req, res) {
    try {
        const userId = resolveNotificationUserId(req);
        if (!userId || isNaN(userId)) {
            return res.status(400).json({
                success: false,
                error: 'User ID is required'
            });
        }

        let unreadCount = 0;
        try {
            const [result] = await db.execute(
                `SELECT COUNT(*) as unreadCount
                 FROM notifications
                 WHERE isRead = FALSE AND userId = ?`,
                [userId]
            );
            unreadCount = (result && result[0] && result[0].unreadCount) ? result[0].unreadCount : 0;
        } catch (dbErr) {
            if (dbErr.code === 'ER_NO_SUCH_TABLE') {
                return res.json({ success: true, unreadCount: 0 });
            }
            throw dbErr;
        }

        res.json({
            success: true,
            unreadCount
        });
    } catch (error) {
        console.error('Error fetching unread count:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch unread count',
            message: error.message
        });
    }
}

// Primary endpoint used in most places
router.get('/unread', handleUnreadCount);

// Backwards-compatible alias for older frontends: /unread-count
router.get('/unread-count', handleUnreadCount);

router.put('/:id/read', async (req, res) => {
    try {
        const notificationId = parseInt(req.params.id);
        const userId = req.user && req.user.userId ? parseInt(req.user.userId, 10) : null;
        if (!userId || isNaN(userId)) {
            return res.status(400).json({ success: false, error: 'User not found in token' });
        }
        
        await db.execute(
            `UPDATE notifications 
             SET isRead = TRUE, readAt = CURRENT_TIMESTAMP 
             WHERE notificationId = ? AND userId = ?`,
            [notificationId, userId]
        );
        
        res.json({
            success: true,
            message: 'Notification marked as read'
        });
    } catch (error) {
        console.error('Error marking notification as read:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to mark notification as read',
            message: error.message 
        });
    }
});

router.put('/:id/unread', async (req, res) => {
    try {
        const notificationId = parseInt(req.params.id);
        const userId = req.user && req.user.userId ? parseInt(req.user.userId, 10) : null;
        if (!userId || isNaN(userId)) {
            return res.status(400).json({ success: false, error: 'User not found in token' });
        }
        
        await db.execute(
            `UPDATE notifications 
             SET isRead = FALSE, readAt = NULL 
             WHERE notificationId = ? AND userId = ?`,
            [notificationId, userId]
        );
        
        res.json({
            success: true,
            message: 'Notification marked as unread'
        });
    } catch (error) {
        console.error('Error marking notification as unread:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to mark notification as unread',
            message: error.message 
        });
    }
});

// Only match numeric IDs so "/clear-all" is not swallowed by this route.
router.delete('/:id(\\d+)', async (req, res) => {
    try {
        const notificationId = parseInt(req.params.id);
        const userId = req.user && req.user.userId ? parseInt(req.user.userId, 10) : null;
        if (!userId || isNaN(userId)) {
            return res.status(400).json({ success: false, error: 'User not found in token' });
        }
        
        await db.execute(
            'DELETE FROM notifications WHERE notificationId = ? AND userId = ?',
            [notificationId, userId]
        );
        
        res.json({
            success: true,
            message: 'Notification deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting notification:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to delete notification',
            message: error.message 
        });
    }
});

router.put('/read-all', async (req, res) => {
    try {
        const userId = req.user && req.user.userId ? parseInt(req.user.userId, 10) : parseInt(req.body.userId);
        if (!userId || isNaN(userId)) {
            return res.status(400).json({
                success: false,
                error: 'User ID is required'
            });
        }

        await db.execute(
            `UPDATE notifications
             SET isRead = TRUE, readAt = CURRENT_TIMESTAMP
             WHERE isRead = FALSE AND userId = ?`,
            [userId]
        );
        
        res.json({
            success: true,
            message: 'All notifications marked as read'
        });
    } catch (error) {
        console.error('Error marking all as read:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to mark all notifications as read',
            message: error.message 
        });
    }
});

router.delete('/clear-all', async (req, res) => {
    try {
        const userId = req.user && req.user.userId ? parseInt(req.user.userId, 10) : parseInt(req.body.userId);
        if (!userId || isNaN(userId)) {
            return res.status(400).json({
                success: false,
                error: 'User ID is required'
            });
        }

        await db.execute('DELETE FROM notifications WHERE userId = ?', [userId]);
        
        res.json({
            success: true,
            message: 'All notifications cleared'
        });
    } catch (error) {
        console.error('Error clearing all notifications:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to clear all notifications',
            message: error.message 
        });
    }
});

router.post('/', async (req, res) => {
    try {
        const { userId, message, recipient, notificationType, relatedEntityType, relatedEntityId } = req.body;
        
        if (!userId || !message || !recipient) {
            return res.status(400).json({
                success: false,
                error: 'userId, message, and recipient are required'
            });
        }
        
        const [result] = await db.execute(
            `INSERT INTO notifications 
             (userId, message, recipient, notificationType, relatedEntityType, relatedEntityId)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                userId,
                message,
                recipient,
                notificationType || 'INFO',
                relatedEntityType || null,
                relatedEntityId || null
            ]
        );
        
        const [newNotification] = await db.execute(
            'SELECT * FROM notifications WHERE notificationId = ?',
            [result.insertId]
        );
        
        res.status(201).json({
            success: true,
            message: 'Notification created successfully',
            data: newNotification[0]
        });
    } catch (error) {
        console.error('Error creating notification:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to create notification',
            message: error.message 
        });
    }
});

module.exports = router;




