/**
 * Require approval token (safe word) for critical admin actions.
 */

const db = require('../config/database');

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
 */
async function requireCriticalApproval(req, res) {
    const isAdmin = req.user && (req.user.role === 'ADMIN' || req.user.role === 'Admin');
    const safeWord = await getApprovalSafeWord();

    if (!safeWord) {
        return null;
    }
    if (!isAdmin) {
        return null;
    }

    const token = req.body && req.body.approvalToken ? String(req.body.approvalToken).trim() : '';
    const match = token === safeWord;

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
