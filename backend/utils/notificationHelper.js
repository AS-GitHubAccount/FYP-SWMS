/**
 * Notification Helper - Power Automate inspired event-driven notifications
 *
 * Provides:
 * - notifyAdmins(message, options) - Create notification for all admins
 * - notifyUser(userId, message, options) - Create notification for specific user
 *
 * Used after key events: booking create/approve/reject, alert create, etc.
 */

const db = require('../config/database');

/**
 * Create a notification by inserting directly into the DB.
 * @param {Object} params
 * @param {number} params.userId - User who triggered the action (creator)
 * @param {string} params.message - Notification message
 * @param {string} params.recipient - Recipient identifier (user name or 'Admin')
 * @param {string} [params.notificationType='INFO'] - INFO, WARNING, SUCCESS
 * @param {string} [params.relatedEntityType] - e.g. 'booking', 'alert'
 * @param {number} [params.relatedEntityId]
 */
async function createNotification({ userId, message, recipient, notificationType = 'INFO', relatedEntityType, relatedEntityId, rejectionReason = null }) {
    try {
        await db.execute(
            `INSERT INTO notifications 
             (userId, type, notificationType, message, recipient, relatedEntityType, relatedEntityId, rejectionReason)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                userId,
                deriveNotificationType({ relatedEntityType, notificationType }),
                notificationType,
                message,
                recipient,
                relatedEntityType || null,
                relatedEntityId || null,
                rejectionReason
            ]
        );
    } catch (err) {
        if (err.code === 'ER_BAD_FIELD_ERROR') {
            try {
                await db.execute(
                    `INSERT INTO notifications (userId, message, recipient, isRead) VALUES (?, ?, ?, FALSE)`,
                    [userId, message, recipient || 'Unknown']
                );
            } catch (e2) {
                console.error('[notificationHelper] Failed to create notification (fallback):', e2.message);
            }
        } else {
            console.error('[notificationHelper] Failed to create notification:', err.message);
        }
    }
}

function deriveNotificationType({ relatedEntityType, notificationType }) {
    if (relatedEntityType === 'alert') return 'Alert';
    if (notificationType === 'SUCCESS' || notificationType === 'WARNING') return 'Result';
    return 'Request';
}

/**
 * Notify all admins. Recipient 'Admin' is shown to users with role ADMIN.
 * @param {string} message - Notification message
 * @param {Object} [options]
 * @param {number} [options.triggeredBy] - User who triggered (e.g. requester)
 * @param {string} [options.notificationType='INFO']
 * @param {string} [options.relatedEntityType]
 * @param {number} [options.relatedEntityId]
 */
async function notifyAdmins(message, options = {}) {
    try {
        // Insert one notification per admin so we can query by userId cleanly.
        const [admins] = await db.execute(`SELECT userId, name FROM users WHERE role = 'ADMIN'`);
        const adminIds = new Set((admins || []).map((a) => Number(a.userId)));
        const notificationType = options.notificationType || 'INFO';
        const relatedEntityType = options.relatedEntityType;
        for (const a of admins) {
            await createNotification({
                userId: a.userId,
                message,
                recipient: a.name || 'Admin',
                notificationType,
                relatedEntityType,
                relatedEntityId: options.relatedEntityId,
                rejectionReason: options.rejectionReason || null,
            });
        }
        // RFQ / purchasing: also inbox the user who created the RFQ (e.g. staff) so they can read or delete the alert.
        const creatorId =
            options.notifyCreatorUserId != null ? parseInt(String(options.notifyCreatorUserId), 10) : NaN;
        if (!isNaN(creatorId) && creatorId > 0 && !adminIds.has(creatorId)) {
            await notifyUser(creatorId, message, {
                triggeredBy: options.triggeredBy || creatorId,
                notificationType,
                relatedEntityType,
                relatedEntityId: options.relatedEntityId,
                rejectionReason: options.rejectionReason || null,
            });
        }
    } catch (e) {
        console.error('[notificationHelper] notifyAdmins failed:', e.message);
    }
    if (options.sendEmail) {
        try {
            const { notifyAdminsByEmail } = require('./emailService');
            await notifyAdminsByEmail(`SWMS: ${options.emailSubject || 'Notification'}`, message);
        } catch (e) { console.error('[notificationHelper] email:', e.message); }
    }
}

/**
 * Notify a specific user by userId. Looks up user name for recipient.
 * @param {number} targetUserId - User to notify
 * @param {string} message - Notification message
 * @param {Object} [options]
 * @param {number} [options.triggeredBy] - User who triggered (e.g. approver)
 * @param {string} [options.notificationType='INFO']
 * @param {string} [options.relatedEntityType]
 * @param {number} [options.relatedEntityId]
 */
async function notifyUser(targetUserId, message, options = {}) {
    if (!targetUserId) return;
    try {
        const [users] = await db.execute('SELECT name, email FROM users WHERE userId = ?', [targetUserId]);
        if (users.length === 0) return;
        const recipient = users[0].name;
        const triggeredBy = options.triggeredBy || targetUserId;
        const notificationType = options.notificationType || 'INFO';
        await createNotification({
            userId: targetUserId,
            message,
            recipient,
            notificationType,
            relatedEntityType: options.relatedEntityType,
            relatedEntityId: options.relatedEntityId,
            rejectionReason: options.rejectionReason || null,
        });
        if (options.sendEmail && users[0].email) {
            try {
                const { sendEmail } = require('./emailService');
                await sendEmail(users[0].email, `SWMS: ${options.emailSubject || 'Notification'}`, `<p>${message}</p>`, message);
            } catch (e) { console.error('[notificationHelper] email:', e.message); }
        }
    } catch (err) {
        console.error('[notificationHelper] notifyUser failed:', err.message);
    }
}

module.exports = {
    createNotification,
    notifyAdmins,
    notifyUser,
};
