/**
 * Self-service forgot-password: after email + name + role match, generate a new password,
 * email it (Password Reset Request template), then store bcrypt hash. SMTP failure does not change the account.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const { sendEmailWithOptions } = require('./emailService');

const GENERIC_MESSAGE =
    'If your details match our records, you will receive an email with a new password shortly. Check your inbox and spam folder.';

function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function generateTempPassword(length = 8) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const bytes = crypto.randomBytes(length);
    let out = '';
    for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];
    return out;
}

function displayFirstName(fullName) {
    const s = String(fullName || '').trim();
    if (!s) return '';
    return s.split(/\s+/)[0];
}

/**
 * Email body matches interim report / stakeholder wording (plain text; HTML mirrors it).
 */
async function sendPasswordResetEmail({ to, firstName, plainPassword }) {
    const subject = 'Password Reset Request';
    const greetingName = firstName || 'there';
    const html = `
<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:Segoe UI,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
  <h2 style="color:#1e293b;">Password Reset Request</h2>
  <p>Hello ${escapeHtml(greetingName)},</p>
  <p>You have requested a password reset for your <strong>Smart Warehouse Management System</strong> account.</p>
  <p><strong>Your new password is:</strong></p>
  <p style="font-size:20px;font-family:Consolas,monospace;letter-spacing:0.05em;background:#f1f5f9;padding:12px 16px;border-radius:8px;border:1px solid #e2e8f0;">${escapeHtml(plainPassword)}</p>
  <p>Please use this password to login to your account. For security reasons, we recommend changing this password after logging in.</p>
</body></html>`;
    const text = `Password Reset Request

Hello ${greetingName},

You have requested a password reset for your Smart Warehouse Management System account.

Your new password is:

${plainPassword}
Please use this password to login to your account. For security reasons, we recommend changing this password after logging in.`;
    return sendEmailWithOptions({ to, subject, html, text });
}

async function applyNewPasswordToUser(userId, passwordHash) {
    try {
        await db.execute(
            `UPDATE users SET passwordHash = ?, inviteTokenHash = NULL, inviteTokenExpires = NULL, accountStatus = 'ACTIVE' WHERE userId = ?`,
            [passwordHash, userId]
        );
    } catch (e) {
        if (e.code === 'ER_BAD_FIELD_ERROR') {
            try {
                await db.execute(
                    `UPDATE users SET passwordHash = ?, inviteTokenHash = NULL, inviteTokenExpires = NULL WHERE userId = ?`,
                    [passwordHash, userId]
                );
            } catch (e2) {
                if (e2.code === 'ER_BAD_FIELD_ERROR') {
                    await db.execute(`UPDATE users SET passwordHash = ? WHERE userId = ?`, [passwordHash, userId]);
                } else {
                    throw e2;
                }
            }
        } else {
            throw e;
        }
    }
}

/**
 * @param {string} emailRaw
 * @param {{ name?: string, role?: string }} [options] — name and role must match when both provided (interim-report flow).
 * @returns {{ success: true, message: string } | { success: false, error: string }}
 */
async function requestSelfServicePasswordReset(emailRaw, options = {}) {
    const emailNorm = String(emailRaw || '')
        .trim()
        .toLowerCase();
    if (!emailNorm || !emailNorm.includes('@')) {
        return { success: false, error: 'Please enter a valid email address.' };
    }

    try {
        const [rows] = await db.execute(
            'SELECT userId, name, email, passwordHash, role FROM users WHERE LOWER(TRIM(email)) = ?',
            [emailNorm]
        );
        if (!rows || rows.length === 0) {
            return { success: true, message: GENERIC_MESSAGE };
        }

        const u = rows[0];

        const nameOpt = options.name != null ? String(options.name).trim() : '';
        const roleOptRaw = options.role != null ? String(options.role).trim().toUpperCase() : '';
        const roleNorm =
            roleOptRaw === 'ADMINISTRATOR' || roleOptRaw === 'ADMIN'
                ? 'ADMIN'
                : roleOptRaw === 'WAREHOUSE STAFF' || roleOptRaw === 'STAFF'
                  ? 'STAFF'
                  : roleOptRaw;
        const wantsVerify = !!(nameOpt || roleOptRaw);
        if (wantsVerify) {
            if (!nameOpt || !roleNorm) {
                return { success: false, error: 'Please fill in email, full name, and position.' };
            }
            const dbName = String(u.name || '')
                .trim()
                .toLowerCase();
            const dbRole = String(u.role || '')
                .trim()
                .toUpperCase();
            if (dbName !== nameOpt.toLowerCase() || dbRole !== roleNorm) {
                return {
                    success: false,
                    error: 'The email, name, and position you entered do not match our records.'
                };
            }
        }

        const plainPassword = generateTempPassword(8);
        const passwordHash = await bcrypt.hash(plainPassword, 10);

        const sent = await sendPasswordResetEmail({
            to: emailNorm,
            firstName: displayFirstName(u.name),
            plainPassword
        });

        if (!sent) {
            console.warn(
                '[forgot-password] SMTP not sending; password left unchanged for userId',
                u.userId
            );
            return { success: true, message: GENERIC_MESSAGE };
        }

        try {
            await applyNewPasswordToUser(u.userId, passwordHash);
        } catch (dbErr) {
            console.error('[forgot-password] DB update after email sent', dbErr.message || dbErr);
            return {
                success: false,
                error: 'Email may have been sent but the password could not be saved. Contact your administrator.'
            };
        }

        return {
            success: true,
            message:
                'A new password has been sent to your email. Please check your email inbox and use the new password to login.'
        };
    } catch (err) {
        console.error('[forgot-password]', err.message || err);
        return { success: true, message: GENERIC_MESSAGE };
    }
}

module.exports = {
    requestSelfServicePasswordReset,
    GENERIC_MESSAGE,
    sendPasswordResetEmail,
    generateTempPassword,
    displayFirstName,
    applyNewPasswordToUser
};
