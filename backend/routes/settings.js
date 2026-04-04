/**
 * System Settings API
 * 
 * Manages system-wide configuration including:
 * - multiLocationEnabled: whether warehouse location management is enabled
 * 
 * GET  /api/settings - Get all settings
 * GET  /api/settings/:key - Get single setting
 * PUT  /api/settings/:key - Update setting (admin only for sensitive keys)
 */

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { requireAdmin } = require('../middleware/auth');

function validateApprovalTokenFormat(token) {
    const t = String(token || '');
    if (t.length < 8) return 'Approval token must be at least 8 characters.';
    if (t.length > 64) return 'Approval token must be 64 characters or fewer.';
    if (/\s/.test(t)) return 'Approval token must not contain spaces.';
    if (!/[A-Z]/.test(t)) return 'Include at least one uppercase letter (A-Z).';
    if (!/[a-z]/.test(t)) return 'Include at least one lowercase letter (a-z).';
    if (!/[0-9]/.test(t)) return 'Include at least one number (0-9).';
    if (!/[^A-Za-z0-9]/.test(t)) return 'Include at least one symbol (e.g. !@#$).';
    return '';
}

// Default values for settings (used when key is missing in DB)
const DEFAULTS = {
    multiLocationEnabled: '0',
    nearExpiryDays: '7',
    companyName: '',
    timezone: 'UTC',
    dateFormat: 'YYYY-MM-DD',
    sessionTimeoutMinutes: '1440',
    emailNotificationsEnabled: '1',
    defaultMinStock: '10',
    approvalSafeWord: ''
};

async function loadAllSettings() {
    const [rows] = await db.execute(
        'SELECT settingKey, settingValue, updatedAt FROM system_settings'
    );
    const settings = { ...DEFAULTS };
    (rows || []).forEach(r => {
        settings[r.settingKey] = r.settingValue;
    });
    // Never expose approval token value to clients.
    settings.approvalSafeWordSet = !!(settings.approvalSafeWord && String(settings.approvalSafeWord).trim());
    settings.approvalSafeWord = '';
    // Computed: email configured (read from env, not stored in DB)
    settings.emailConfigured = !!(process.env.SMTP_USER && process.env.SMTP_PASS);
    return settings;
}

async function getCurrentApprovalToken() {
    const [rows] = await db.execute(
        "SELECT settingValue FROM system_settings WHERE settingKey = 'approvalSafeWord'"
    );
    return rows[0] && rows[0].settingValue ? String(rows[0].settingValue).trim() : '';
}

router.put('/approval-token', requireAdmin, async (req, res) => {
    try {
        const body = req.body || {};
        const enabled = !!body.enabled;
        const currentToken = body.currentToken != null ? String(body.currentToken).trim() : '';
        const newToken = body.newToken != null ? String(body.newToken).trim() : '';
        const confirmToken = body.confirmToken != null ? String(body.confirmToken).trim() : '';

        const existing = await getCurrentApprovalToken();
        const hasExisting = !!existing;

        if (!enabled) {
            // Disabling requires current token when one is already set.
            if (hasExisting && currentToken !== existing) {
                return res.status(401).json({
                    success: false,
                    error: 'Current approval token is incorrect'
                });
            }
            await db.execute(
                `INSERT INTO system_settings (settingKey, settingValue)
                 VALUES ('approvalSafeWord', '')
                 ON DUPLICATE KEY UPDATE settingValue = ''`
            );
            return res.json({ success: true, message: 'Approval token disabled', data: { approvalSafeWordSet: false } });
        }

        // Enable/change flow
        if (hasExisting && currentToken !== existing) {
            return res.status(401).json({
                success: false,
                error: 'Current approval token is incorrect'
            });
        }
        if (!newToken || !confirmToken) {
            return res.status(400).json({ success: false, error: 'newToken and confirmToken are required' });
        }
        if (newToken !== confirmToken) {
            return res.status(400).json({ success: false, error: 'New token and confirmation do not match' });
        }
        const formatErr = validateApprovalTokenFormat(newToken);
        if (formatErr) {
            return res.status(400).json({ success: false, error: formatErr });
        }
        if (hasExisting && newToken === existing) {
            return res.status(400).json({ success: false, error: 'New approval token must be different from current token' });
        }

        await db.execute(
            `INSERT INTO system_settings (settingKey, settingValue)
             VALUES ('approvalSafeWord', ?)
             ON DUPLICATE KEY UPDATE settingValue = VALUES(settingValue)`,
            [newToken]
        );
        return res.json({ success: true, message: 'Approval token updated', data: { approvalSafeWordSet: true } });
    } catch (e) {
        if (e.code === 'ER_NO_SUCH_TABLE') {
            return res.status(503).json({
                success: false,
                error: 'system_settings table not found. Run setup.sql or migrations.'
            });
        }
        return res.status(500).json({ success: false, error: e.message });
    }
});

router.get('/', async (req, res) => {
    try {
        const settings = await loadAllSettings();
        res.json({
            success: true,
            data: settings
        });
    } catch (e) {
        if (e.code === 'ER_NO_SUCH_TABLE') {
            return res.json({
                success: true,
                data: { ...DEFAULTS, emailConfigured: !!(process.env.SMTP_USER && process.env.SMTP_PASS) }
            });
        }
        res.status(500).json({ success: false, error: e.message });
    }
});

router.put('/', requireAdmin, async (req, res) => {
    try {
        const body = req.body || {};
        if (typeof body !== 'object' || Array.isArray(body)) {
            return res.status(400).json({ success: false, error: 'Invalid settings payload' });
        }

        const keys = Object.keys(body);
        if (!keys.length) {
            return res.status(400).json({ success: false, error: 'No settings provided' });
        }

        // Upsert every provided key/value into system_settings.
        // Note: some keys may be unknown to DEFAULTS; that's fine: they will still be persisted.
        for (const key of keys) {
            if (key === 'approvalSafeWord') continue; // managed by /approval-token endpoint
            const value = body[key];
            if (value === undefined) continue;
            await db.execute(
                `INSERT INTO system_settings (settingKey, settingValue)
                 VALUES (?, ?)
                 ON DUPLICATE KEY UPDATE settingValue = VALUES(settingValue)`,
                [key, String(value)]
            );
        }

        const settings = await loadAllSettings();
        res.json({ success: true, message: 'Settings updated', data: settings });
    } catch (e) {
        if (e.code === 'ER_NO_SUCH_TABLE') {
            return res.status(503).json({
                success: false,
                error: 'system_settings table not found. Run setup.sql or migrations.'
            });
        }
        res.status(500).json({ success: false, error: e.message });
    }
});

router.get('/:key', async (req, res) => {
    try {
        const { key } = req.params;
        const [rows] = await db.execute(
            'SELECT settingKey, settingValue, updatedAt FROM system_settings WHERE settingKey = ?',
            [key]
        );
        if (rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Setting not found' });
        }
        res.json({
            success: true,
            data: { key: rows[0].settingKey, value: rows[0].settingValue }
        });
    } catch (e) {
        if (e.code === 'ER_NO_SUCH_TABLE') {
            return res.json({ success: true, data: { key: req.params.key, value: '0' } });
        }
        res.status(500).json({ success: false, error: e.message });
    }
});

router.put('/:key', requireAdmin, async (req, res) => {
    try {
        const { key } = req.params;
        const { value } = req.body;
        if (key === 'approvalSafeWord') {
            return res.status(400).json({ success: false, error: 'Use PUT /api/settings/approval-token to manage approval token' });
        }
        
        if (value === undefined || value === null) {
            return res.status(400).json({ success: false, error: 'value required' });
        }
        
        const strValue = String(value);
        
        await db.execute(
            `INSERT INTO system_settings (settingKey, settingValue) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE settingValue = VALUES(settingValue)`,
            [key, strValue]
        );
        
        const [rows] = await db.execute(
            'SELECT settingKey, settingValue, updatedAt FROM system_settings WHERE settingKey = ?',
            [key]
        );
        
        res.json({
            success: true,
            message: 'Setting updated',
            data: rows[0] ? { key: rows[0].settingKey, value: rows[0].settingValue } : { key, value: strValue }
        });
    } catch (e) {
        if (e.code === 'ER_NO_SUCH_TABLE') {
            return res.status(503).json({
                success: false,
                error: 'system_settings table not found. Run setup.sql or migrations.'
            });
        }
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
