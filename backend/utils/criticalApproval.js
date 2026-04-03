/**
 * Swiss Cheese / layered security: require approval token for critical actions (Admin).
 * Logs all attempts to audit_log.
 */

const db = require('../config/database');
const { logAudit, getClientIp, getUserAgent } = require('./auditLogger');

async function getApprovalSafeWord() {
    try {
        const [rows] = await db.execute(
            "SELECT settingValue FROM system_settings WHERE settingKey = 'approvalSafeWord'"
        );
        const v = rows[0] && rows[0].settingValue ? String(rows[0].settingValue).trim() : '';
        return v;
    } catch {
        return '';
    }
}

/**
 * If approval token is required (Admin + safe word set), verify req.body.approvalToken.
 * Returns: null if caller should proceed; otherwise res has been sent (caller should return).
 * @param {object} req - Express request (req.user, req.body.approvalToken)
 * @param {object} res - Express response
 * @param {string} criticalAction - e.g. 'delete_product', 'approve_disposal', 'approve_withdrawal'
 */
async function requireCriticalApproval(req, res, criticalAction) {
    const userId = req.user && req.user.userId;
    const userName = req.user && req.user.name;
    const isAdmin = req.user && (req.user.role === 'ADMIN' || req.user.role === 'Admin');
    const safeWord = await getApprovalSafeWord();

    const logAttempt = async (success, tokenProvided) => {
        try {
            await logAudit({
                tableName: 'critical_action',
                recordId: 0,
                action: 'VERIFY',
                userId,
                userName,
                oldValues: null,
                newValues: { criticalAction, success, tokenProvided },
                ipAddress: getClientIp(req),
                userAgent: getUserAgent(req)
            });
        } catch (e) {
            console.error('criticalApproval logAttempt:', e);
        }
    };

    if (!safeWord) {
        return null;
    }
    if (!isAdmin) {
        return null;
    }

    const token = req.body && req.body.approvalToken ? String(req.body.approvalToken).trim() : '';
    const match = token === safeWord;
    await logAttempt(match, !!token);

    if (!match) {
        res.status(403).json({
            success: false,
            error: 'Approval required',
            message: 'This action requires the Approval Token (Safe Word). Enter it in the verification window.'
        });
        return res;
    }
    return null;
}

module.exports = { requireCriticalApproval, getApprovalSafeWord };
