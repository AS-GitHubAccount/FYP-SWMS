/**
 * Action-based alert removal: delete alerts when user takes an action (disposal, issue, purchase).
 */

const db = require('../config/database');

/**
 * @param {Object} opts - { productId, batchId (optional), alertTypes: string[] }
 */
async function removeAlertsAndLog(opts) {
    const { productId, batchId, alertTypes } = opts;
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

    for (const row of rows || []) {
        await db.execute('DELETE FROM alerts WHERE alertId = ?', [row.alertId]);
    }
}

module.exports = { removeAlertsAndLog };
