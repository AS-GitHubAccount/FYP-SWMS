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

router.get('/', async (req, res) => {
    try {
        const userId = req.user && req.user.userId ? parseInt(req.user.userId, 10) : parseInt(req.query.userId, 10);
        if (!userId || isNaN(userId)) {
            return res.status(400).json({
                success: false,
                error: 'User ID is required'
            });
        }

        let notifications = [];
        try {
            const [rows] = await db.execute(
                `SELECT n.*
                 FROM notifications n
                 WHERE n.userId = ?
                 ORDER BY n.createdAt DESC`,
                [userId]
            );
            notifications = rows || [];
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
        const userId = req.user && req.user.userId ? parseInt(req.user.userId, 10) : parseInt(req.query.userId, 10);
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




