/**
 * Audit Logger Utility
 * 
 * Automatically logs all database changes to audit_log table
 */

const db = require('../config/database');

/**
 * Log a database change to audit_log
 * @param {Object} options - Audit log options
 * @param {string} options.tableName - Name of the table being changed
 * @param {number} options.recordId - ID of the record being changed
 * @param {string} options.action - Action type: 'INSERT', 'UPDATE', or 'DELETE'
 * @param {number} options.userId - ID of user making the change
 * @param {string} options.userName - Name of user making the change
 * @param {Object} options.oldValues - Old values (for UPDATE/DELETE)
 * @param {Object} options.newValues - New values (for INSERT/UPDATE)
 * @param {string} options.ipAddress - IP address of the request
 * @param {string} options.userAgent - User agent of the request
 */
async function logAudit(options) {
    try {
        const {
            tableName,
            recordId,
            action,
            userId = null,
            userName = null,
            oldValues = null,
            newValues = null,
            ipAddress = null,
            userAgent = null
        } = options;

        // Determine which fields changed (for UPDATE)
        let changedFields = null;
        if (action === 'UPDATE' && oldValues && newValues) {
            const changed = [];
            for (const key in newValues) {
                if (oldValues[key] !== newValues[key]) {
                    changed.push(key);
                }
            }
            changedFields = changed.length > 0 ? changed.join(', ') : null;
        }

        // Convert objects to JSON strings
        const oldValuesJson = oldValues ? JSON.stringify(oldValues) : null;
        const newValuesJson = newValues ? JSON.stringify(newValues) : null;

        await db.execute(
            `INSERT INTO audit_log 
             (tableName, recordId, action, userId, userName, oldValues, newValues, changedFields, ipAddress, userAgent)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                tableName,
                recordId,
                action,
                userId,
                userName,
                oldValuesJson,
                newValuesJson,
                changedFields,
                ipAddress,
                userAgent
            ]
        );
    } catch (error) {
        // Don't throw error - audit logging should not break the main operation
        console.error('Error logging audit:', error);
    }
}

/**
 * Get client IP address from request
 */
function getClientIp(req) {
    return req.headers['x-forwarded-for']?.split(',')[0] || 
           req.connection?.remoteAddress || 
           req.socket?.remoteAddress ||
           null;
}

/**
 * Get user agent from request
 */
function getUserAgent(req) {
    return req.headers['user-agent'] || null;
}

module.exports = {
    logAudit,
    getClientIp,
    getUserAgent
};





