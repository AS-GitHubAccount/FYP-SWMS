/**
 * Action-based alert removal: delete alerts when user takes an action (disposal, issue, purchase)
 * and log to audit: "Alert [ID] removed following Action: [Action Name] by User [ID]"
 */

const db = require('../config/database');
const { logAudit, getClientIp, getUserAgent } = require('./auditLogger');

/**
 * Remove alerts matching criteria and log each removal to audit_log.
 * @param {Object} opts - { productId, batchId (optional), alertTypes: string[] }
 * @param {Object} context - { userId, actionName, req }
 */
async function removeAlertsAndLog(opts, context) {
    const { productId, batchId, alertTypes } = opts;
    const { userId, actionName, req } = context;
    if (!productId || !alertTypes || !Array.isArray(alertTypes) || alertTypes.length === 0) return;

    const params = [productId];
    let where = ' productId = ? AND alertType IN (' + alertTypes.map(() => '?').join(',') + ')';
    alertTypes.forEach(t => params.push(t));
    if (batchId != null) {
        where += ' AND batchId = ?';
        params.push(batchId);
    }

    const [rows] = await db.execute(
        'SELECT alertId FROM alerts WHERE ' + where,
        params
    );
    const ip = req ? getClientIp(req) : null;
    const ua = req ? getUserAgent(req) : null;

    for (const row of rows || []) {
        await db.execute('DELETE FROM alerts WHERE alertId = ?', [row.alertId]);
        await logAudit({
            tableName: 'alerts',
            recordId: row.alertId,
            action: 'DELETE',
            userId: userId || null,
            userName: null,
            oldValues: { alertId: row.alertId },
            newValues: { summary: `Alert ${row.alertId} removed following Action: ${actionName} by User ${userId || 'system'}` },
            ipAddress: ip,
            userAgent: ua
        });
    }
}

module.exports = { removeAlertsAndLog };
