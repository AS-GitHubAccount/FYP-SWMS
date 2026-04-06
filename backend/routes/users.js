// /api/users
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const getConnectionErrorMessage = db.getConnectionErrorMessage || ((e) => e && e.message);
const { requireAdmin } = require('../middleware/auth');
const { sendEmailWithOptions } = require('../utils/emailService');
const {
    generateInviteToken,
    hashInviteToken,
    defaultInviteExpiry,
    getFrontendBaseUrl
} = require('../utils/userInviteTokens');
const {
    sendPasswordResetEmail,
    generateTempPassword,
    displayFirstName,
    applyNewPasswordToUser
} = require('../utils/passwordResetRequest');

const USER_LIST_FIELDS = `userId, name, email, role, createdAt,
  COALESCE(accountStatus, 'ACTIVE') AS accountStatus,
  (passwordHash IS NULL OR passwordHash = '') AS passwordPending,
  (inviteTokenHash IS NOT NULL AND (inviteTokenExpires IS NULL OR inviteTokenExpires > NOW())) AS hasValidInvite`;

async function sendInviteOrResetEmail({ to, name, rawToken, subject, introHtml }) {
    const base = getFrontendBaseUrl();
    const link = `${base}/set-password.html?token=${encodeURIComponent(rawToken)}`;
    const html = `
<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:Segoe UI,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
  <h2 style="color:#1e293b;">${subject}</h2>
  <p>Hello ${escapeHtml(name || 'there')},</p>
  <p>${introHtml}</p>
  <p style="margin:24px 0;">
    <a href="${link}" style="display:inline-block;background:#15803d;color:#fff;padding:12px 20px;text-decoration:none;border-radius:8px;font-weight:600;">Set your password</a>
  </p>
  <p style="font-size:13px;color:#64748b;">This link expires in 7 days. If you did not expect this email, contact your administrator.</p>
  <p style="font-size:12px;color:#94a3b8;word-break:break-all;">If the button does not work, copy this URL:<br>${escapeHtml(link)}</p>
</body></html>`;
    const text = `${subject}\n\n${introHtml.replace(/<[^>]+>/g, '')}\n\nOpen: ${link}`;
    return sendEmailWithOptions({ to, subject, html, text });
}

function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Accept only real positive integer ids (avoids parseInt('1abc') === 1 and non-numeric strings reaching SQL). */
function parseStrictPositiveInt(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) return null;
        const i = Math.trunc(value);
        return i > 0 ? i : null;
    }
    const s = String(value).trim();
    if (!/^\d+$/.test(s)) return null;
    const n = parseInt(s, 10);
    return n > 0 ? n : null;
}

/** Numeric userId from a DB row (handles occasional driver/casing quirks). */
function userIdFromRow(row) {
    if (!row) return null;
    const v = row.userId != null ? row.userId : row.userid;
    return parseStrictPositiveInt(v);
}

/**
 * JWT should carry numeric userId; if missing or corrupted, resolve from users.email.
 */
async function resolveActorUserId(req) {
    const raw = req.user && (req.user.userId != null ? req.user.userId : req.user.sub);
    let n = parseStrictPositiveInt(raw);
    if (n != null) return n;
    const email = req.user && req.user.email && String(req.user.email).trim().toLowerCase();
    if (!email) return null;
    try {
        const [rows] = await db.execute(
            'SELECT userId FROM users WHERE LOWER(TRIM(email)) = ? LIMIT 1',
            [email]
        );
        if (rows && rows[0]) return parseStrictPositiveInt(rows[0].userId);
    } catch (e) {
        console.warn('[users] resolveActorUserId lookup failed:', e.message);
    }
    return null;
}

/**
 * WHERE clause for columns that may be INT (user id) or VARCHAR (display name) — see receiving.js / issuing.js.
 * Pure string comparison avoids MySQL coercing values like 'Admin User' to DOUBLE (ER_TRUNCATED_WRONG_VALUE).
 */
function whereUserRefMatchesColumn(column, fromId, displayName) {
    const col = `\`${column}\``;
    const clauses = [`BINARY CAST(${col} AS CHAR(255)) = BINARY CAST(? AS CHAR(255))`];
    const params = [String(fromId)];
    const dn = displayName != null && String(displayName).trim() ? String(displayName).trim() : '';
    if (dn) {
        clauses.push(`BINARY CAST(${col} AS CHAR(255)) = BINARY CAST(? AS CHAR(255))`);
        params.push(dn);
    }
    return { where: clauses.join(' OR '), params };
}

function mapUserPublic(row) {
    if (!row) return null;
    const pending =
        String(row.accountStatus || '').toUpperCase() === 'PENDING_INVITE' ||
        (row.passwordPending === 1 || row.passwordPending === true);
    const hasInvite = row.hasValidInvite === 1 || row.hasValidInvite === true;
    return {
        userId: userIdFromRow(row),
        name: row.name,
        email: row.email,
        role: row.role,
        createdAt: row.createdAt,
        accountStatus: row.accountStatus || 'ACTIVE',
        invitationPending: pending,
        hasValidInvite: hasInvite
    };
}

router.put('/me/password', async (req, res) => {
    try {
        const userId = req.user && req.user.userId;
        if (!userId) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }
        const { currentPassword, newPassword } = req.body || {};
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ success: false, error: 'currentPassword and newPassword are required' });
        }
        if (String(newPassword).length < 6) {
            return res.status(400).json({ success: false, error: 'New password must be at least 6 characters' });
        }
        const [users] = await db.execute('SELECT * FROM users WHERE userId = ?', [userId]);
        if (!users.length) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        const u = users[0];
        if (!u.passwordHash) {
            return res.status(400).json({
                success: false,
                error: 'Use the invitation link from your email to set your first password.'
            });
        }
        const ok = await bcrypt.compare(currentPassword, u.passwordHash);
        if (!ok) {
            return res.status(401).json({ success: false, error: 'Current password is incorrect' });
        }
        const passwordHash = await bcrypt.hash(newPassword, 10);
        await db.execute(
            'UPDATE users SET passwordHash = ?, inviteTokenHash = NULL, inviteTokenExpires = NULL, accountStatus = ? WHERE userId = ?',
            [passwordHash, 'ACTIVE', userId]
        );
        res.json({ success: true, message: 'Password updated successfully' });
    } catch (error) {
        console.error('PUT /users/me/password', error);
        res.status(500).json({ success: false, error: 'Failed to update password', message: error.message });
    }
});

router.put('/me', async (req, res) => {
    try {
        const userId = req.user && req.user.userId;
        if (!userId) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }
        const { name, email, password } = req.body || {};
        if (password != null && String(password).length > 0) {
            return res.status(400).json({
                success: false,
                error: 'Use Settings → Change Password (PUT /api/users/me/password) to update your password.'
            });
        }
        if (!name && !email) {
            return res.status(400).json({ success: false, error: 'Provide name and/or email to update' });
        }
        const [users] = await db.execute('SELECT * FROM users WHERE userId = ?', [userId]);
        if (!users.length) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        const updates = [];
        const values = [];
        if (name != null && String(name).trim()) {
            updates.push('name = ?');
            values.push(String(name).trim());
        }
        if (email != null && String(email).trim()) {
            const em = String(email).trim().toLowerCase();
            const [taken] = await db.execute('SELECT userId FROM users WHERE LOWER(email) = ? AND userId != ?', [
                em,
                userId
            ]);
            if (taken.length > 0) {
                return res.status(400).json({ success: false, error: 'Email already in use by another user' });
            }
            updates.push('email = ?');
            values.push(em);
        }
        if (updates.length === 0) {
            return res.status(400).json({ success: false, error: 'No valid fields to update' });
        }
        values.push(userId);
        await db.execute(`UPDATE users SET ${updates.join(', ')} WHERE userId = ?`, values);
        const [updatedUser] = await db.execute(`SELECT ${USER_LIST_FIELDS} FROM users WHERE userId = ?`, [userId]).catch(
            async () => {
                const [u] = await db.execute(
                    'SELECT userId, name, email, role, createdAt FROM users WHERE userId = ?',
                    [userId]
                );
                return [u];
            }
        );
        res.json({
            success: true,
            message: 'Profile updated successfully',
            data: mapUserPublic(updatedUser[0])
        });
    } catch (error) {
        console.error('PUT /users/me', error);
        res.status(500).json({ success: false, error: 'Failed to update profile', message: error.message });
    }
});

router.get('/', async (req, res) => {
    try {
        let rows;
        try {
            const [r] = await db.execute(
                `SELECT ${USER_LIST_FIELDS} FROM users ORDER BY createdAt DESC`
            );
            rows = r;
        } catch (e) {
            if (e.code === 'ER_BAD_FIELD_ERROR') {
                const [r2] = await db.execute(
                    'SELECT userId, name, email, role, createdAt FROM users ORDER BY createdAt DESC'
                );
                rows = (r2 || []).map((x) => ({
                    ...x,
                    accountStatus: 'ACTIVE',
                    passwordPending: false,
                    hasValidInvite: false
                }));
            } else throw e;
        }
        const users = (rows || []).map(mapUserPublic);
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.json({ success: true, data: users, count: users.length });
    } catch (error) {
        console.error('Error fetching users:', error);
        const isDbError =
            error.code === 'ECONNREFUSED' ||
            error.code === 'ER_ACCESS_DENIED_ERROR' ||
            error.code === 'ER_BAD_DB_ERROR';
        const status = isDbError ? 503 : 500;
        res.status(status).json({
            success: false,
            error: isDbError
                ? error.userMessage ||
                  getConnectionErrorMessage(error) ||
                  'Unable to connect to the database. Please contact the administrator.'
                : 'Failed to fetch users',
            message: error.message
        });
    }
});

router.get('/:id(\\d+)', async (req, res) => {
    try {
        const userId = parseInt(req.params.id, 10);
        let rows;
        try {
            const [r] = await db.execute(
                `SELECT ${USER_LIST_FIELDS} FROM users WHERE userId = ?`,
                [userId]
            );
            rows = r;
        } catch (e) {
            if (e.code === 'ER_BAD_FIELD_ERROR') {
                const [r2] = await db.execute(
                    'SELECT userId, name, email, role, createdAt FROM users WHERE userId = ?',
                    [userId]
                );
                rows = r2;
            } else throw e;
        }
        if (!rows || rows.length === 0) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        res.json({ success: true, data: mapUserPublic(rows[0]) });
    } catch (error) {
        console.error('Error fetching user:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch user', message: error.message });
    }
});

// mode: invite | reset
async function setInviteTokenForUser(userId, mode) {
    const rawToken = generateInviteToken();
    const hash = hashInviteToken(rawToken);
    const exp = defaultInviteExpiry();
    if (mode === 'invite') {
        await db.execute(
            `UPDATE users SET inviteTokenHash = ?, inviteTokenExpires = ?, accountStatus = 'PENDING_INVITE' WHERE userId = ?`,
            [hash, exp, userId]
        );
    } else {
        await db.execute(`UPDATE users SET inviteTokenHash = ?, inviteTokenExpires = ? WHERE userId = ?`, [hash, exp, userId]);
    }
    return { rawToken, exp };
}

router.post('/', requireAdmin, async (req, res) => {
    try {
        const { name, email, role, password } = req.body || {};
        if (password) {
            return res.status(400).json({
                success: false,
                error: 'Passwords are not set by admins. An email invitation is sent instead.'
            });
        }
        if (!name || !email) {
            return res.status(400).json({ success: false, error: 'Name and email are required' });
        }
        const emailNorm = String(email).trim().toLowerCase();
        const [existing] = await db.execute('SELECT userId FROM users WHERE LOWER(email) = ?', [emailNorm]);
        if (existing.length > 0) {
            return res.status(400).json({ success: false, error: 'User with this email already exists.' });
        }
        const roleUpper = (role || 'STAFF').toUpperCase();
        const roleDb = roleUpper === 'ADMIN' ? 'ADMIN' : 'STAFF';
        let newId;
        try {
            const [result] = await db.execute(
                `INSERT INTO users (name, email, passwordHash, role, accountStatus)
       VALUES (?, ?, NULL, ?, 'PENDING_INVITE')`,
                [name.trim(), emailNorm, roleDb]
            );
            newId = result.insertId;
        } catch (insertErr) {
            if (insertErr.code === 'ER_BAD_FIELD_ERROR') {
                const [result2] = await db.execute(
                    `INSERT INTO users (name, email, passwordHash, role) VALUES (?, ?, NULL, ?)`,
                    [name.trim(), emailNorm, roleDb]
                );
                newId = result2.insertId;
            } else {
                throw insertErr;
            }
        }
        const { rawToken } = await setInviteTokenForUser(newId, 'invite');
        const [newUser] = await db.execute(
            `SELECT ${USER_LIST_FIELDS} FROM users WHERE userId = ?`,
            [newId]
        ).catch(async () => {
            const [nu] = await db.execute(
                'SELECT userId, name, email, role, createdAt FROM users WHERE userId = ?',
                [newId]
            );
            return [nu];
        });

        const sent = await sendInviteOrResetEmail({
            to: emailNorm,
            name: name.trim(),
            rawToken,
            subject: 'SWMS — Complete your account setup',
            introHtml: '<strong>Welcome to SWMS.</strong> Click the button below to choose your password and activate your account.'
        });

        if (!sent) {
            console.warn(
                '[users] Invitation created but email not sent (configure SMTP_USER/SMTP_PASS). Dev link:',
                `${getFrontendBaseUrl()}/set-password.html?token=${rawToken}`
            );
        }

        res.status(201).json({
            success: true,
            message: sent
                ? 'User invited. They will receive an email to set their password.'
                : 'User created but invitation email could not be sent. Configure SMTP or share the setup link manually (see server log).',
            invitationEmailSent: !!sent,
            data: mapUserPublic(newUser[0]) || { userId: newId, name, email: emailNorm, role: roleUpper }
        });
    } catch (error) {
        console.error('Error creating user:', error);
        res.status(500).json({ success: false, error: 'Failed to create user', message: error.message });
    }
});

router.put('/:id(\\d+)', requireAdmin, async (req, res) => {
    try {
        const userId = parseInt(req.params.id, 10);
        const { name, email, role, password } = req.body || {};
        if (password) {
            return res.status(400).json({
                success: false,
                error: 'Admins cannot set passwords. Use Resend invitation or Reset password email.'
            });
        }
        const [users] = await db.execute('SELECT * FROM users WHERE userId = ?', [userId]);
        if (users.length === 0) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        const updates = [];
        const values = [];
        if (name) {
            updates.push('name = ?');
            values.push(name);
        }
        if (email) {
            const em = String(email).trim().toLowerCase();
            const [taken] = await db.execute('SELECT userId FROM users WHERE LOWER(email) = ? AND userId != ?', [
                em,
                userId
            ]);
            if (taken.length > 0) {
                return res.status(400).json({ success: false, error: 'Email already in use by another user' });
            }
            updates.push('email = ?');
            values.push(em);
        }
        if (role) {
            updates.push('role = ?');
            values.push(String(role).toUpperCase() === 'ADMIN' ? 'ADMIN' : 'STAFF');
        }
        if (updates.length === 0) {
            return res.status(400).json({ success: false, error: 'No fields to update' });
        }
        values.push(userId);
        await db.execute(`UPDATE users SET ${updates.join(', ')} WHERE userId = ?`, values);
        const [updatedUser] = await db.execute(`SELECT ${USER_LIST_FIELDS} FROM users WHERE userId = ?`, [
            userId
        ]).catch(async () => {
            const [u] = await db.execute('SELECT userId, name, email, role, createdAt FROM users WHERE userId = ?', [
                userId
            ]);
            return [u];
        });
        res.json({
            success: true,
            message: 'User updated successfully',
            data: mapUserPublic(updatedUser[0])
        });
    } catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({ success: false, error: 'Failed to update user', message: error.message });
    }
});

/**
 * Clear or reassign FK references so DELETE FROM users can succeed (MySQL RESTRICT on most userId FKs).
 * Nullable actor columns → NULL. Required requester/adjuster columns → reassignToUserId (the admin performing delete).
 * @param {string} [deletedUserDisplayName] users.name for the row being deleted (clears VARCHAR name-stored receiving/issuing refs).
 */
async function unlinkUserReferences(conn, fromUserId, reassignToUserId, deletedUserDisplayName) {
    const safeExec = async (sql, params = []) => {
        try {
            await conn.execute(sql, params);
        } catch (e) {
            if (e.code === 'ER_NO_SUCH_TABLE' || e.code === 'ER_BAD_FIELD_ERROR') {
                console.warn('[users] unlink skip (schema):', sql.slice(0, 60), e.message);
                return;
            }
            throw e;
        }
    };
    const from = parseStrictPositiveInt(fromUserId);
    const to = parseStrictPositiveInt(reassignToUserId);
    if (from == null || to == null) {
        throw new Error('Invalid user ids for reassignment');
    }

    const inWhere = whereUserRefMatchesColumn('receivedBy', from, deletedUserDisplayName);
    await safeExec(`UPDATE in_records SET receivedBy = NULL WHERE ${inWhere.where}`, inWhere.params);
    const outWhere = whereUserRefMatchesColumn('issuedBy', from, deletedUserDisplayName);
    await safeExec(`UPDATE out_records SET issuedBy = NULL WHERE ${outWhere.where}`, outWhere.params);
    await safeExec('UPDATE alerts SET resolvedBy = NULL WHERE resolvedBy = ?', [from]);

    await safeExec('UPDATE bookings SET approvedBy = NULL WHERE approvedBy = ?', [from]);
    await safeExec('UPDATE bookings SET requestedBy = ? WHERE requestedBy = ?', [to, from]);

    await safeExec('UPDATE purchase_requests SET approvedBy = NULL WHERE approvedBy = ?', [from]);
    await safeExec('UPDATE purchase_requests SET rejectedBy = NULL WHERE rejectedBy = ?', [from]);
    await safeExec('UPDATE purchase_requests SET requestedBy = ? WHERE requestedBy = ?', [to, from]);

    await safeExec('UPDATE disposal_requests SET approvedBy = NULL WHERE approvedBy = ?', [from]);
    await safeExec('UPDATE disposal_requests SET rejectedBy = NULL WHERE rejectedBy = ?', [from]);
    await safeExec('UPDATE disposal_requests SET completedBy = NULL WHERE completedBy = ?', [from]);
    await safeExec('UPDATE disposal_requests SET requestedBy = ? WHERE requestedBy = ?', [to, from]);

    await safeExec('UPDATE stock_adjustments SET adjustedBy = ? WHERE adjustedBy = ?', [to, from]);

    await safeExec('UPDATE rfqs SET createdBy = NULL WHERE createdBy = ?', [from]);
    await safeExec('UPDATE quotations SET createdBy = NULL WHERE createdBy = ?', [from]);
    await safeExec('UPDATE purchase_orders SET createdBy = NULL WHERE createdBy = ?', [from]);
}

router.delete('/:id(\\d+)', requireAdmin, async (req, res) => {
    try {
        const userId = parseStrictPositiveInt(req.params.id);
        if (userId == null) {
            return res.status(400).json({ success: false, error: 'Invalid user id' });
        }
        const reassignTo = await resolveActorUserId(req);
        if (reassignTo == null) {
            return res.status(400).json({ success: false, error: 'Invalid admin session' });
        }
        if (userId === reassignTo) {
            return res.status(400).json({ success: false, error: 'You cannot delete your own account from this list' });
        }

        const [users] = await db.execute('SELECT * FROM users WHERE userId = ?', [userId]);
        if (users.length === 0) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        const user = users[0];
        if (user.role === 'ADMIN') {
            const [adminCount] = await db.execute("SELECT COUNT(*) AS count FROM users WHERE role = ?", ['ADMIN']);
            if (adminCount[0].count <= 1) {
                return res.status(400).json({ success: false, error: 'Cannot delete the last admin user' });
            }
        }

        const pool = db;
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            await unlinkUserReferences(conn, userId, reassignTo, user.name);
            await conn.execute('DELETE FROM users WHERE userId = ?', [userId]);
            await conn.commit();
        } catch (txErr) {
            try {
                await conn.rollback();
            } catch (rbErr) {
                console.error('[users] rollback failed:', rbErr);
            }
            throw txErr;
        } finally {
            conn.release();
        }

        res.json({
            success: true,
            message: 'User deleted successfully. Their past requests were reassigned to you for history continuity.'
        });
    } catch (error) {
        console.error('Error deleting user:', error);
        const msg = error.message || String(error);
        const isFk =
            error.code === 'ER_ROW_IS_REFERENCED_2' ||
            error.errno === 1451 ||
            /Cannot delete or update a parent row/i.test(msg);
        res.status(500).json({
            success: false,
            error: 'Failed to delete user',
            message: isFk
                ? 'This user is still referenced by data the server could not reassign. Check server logs or contact support.'
                : msg
        });
    }
});

router.post('/:id(\\d+)/resend-invitation', requireAdmin, async (req, res) => {
    try {
        const userId = parseInt(req.params.id, 10);
        const [users] = await db.execute('SELECT * FROM users WHERE userId = ?', [userId]);
        if (!users.length) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        const u = users[0];
        if (u.passwordHash) {
            return res.status(400).json({ success: false, error: 'User already activated. Use Reset password email instead.' });
        }
        const { rawToken } = await setInviteTokenForUser(userId, 'invite');
        const sent = await sendInviteOrResetEmail({
            to: u.email,
            name: u.name,
            rawToken,
            subject: 'SWMS — Complete your account setup',
            introHtml: '<strong>Invitation reminder.</strong> Set your password using the link below.'
        });
        if (!sent) {
            console.warn('[users] Resend: SMTP missing. Link:', `${getFrontendBaseUrl()}/set-password.html?token=${rawToken}`);
        }
        res.json({
            success: true,
            message: sent ? 'Invitation email sent.' : 'Token renewed but email not sent (check SMTP / server log).',
            invitationEmailSent: !!sent
        });
    } catch (error) {
        console.error('resend-invitation', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/:id(\\d+)/send-password-reset', requireAdmin, async (req, res) => {
    try {
        const userId = parseInt(req.params.id, 10);
        const [users] = await db.execute('SELECT * FROM users WHERE userId = ?', [userId]);
        if (!users.length) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        const u = users[0];
        const emailNorm = String(u.email || '')
            .trim()
            .toLowerCase();
        const plainPassword = generateTempPassword(8);
        const passwordHash = await bcrypt.hash(plainPassword, 10);

        const sent = await sendPasswordResetEmail({
            to: emailNorm,
            firstName: displayFirstName(u.name),
            plainPassword
        });

        if (!sent) {
            console.warn('[users] Reset: SMTP missing; password not saved for userId', userId);
            return res.status(503).json({
                success: false,
                error: 'Email could not be sent (check SMTP). The user password was not changed.'
            });
        }

        try {
            await applyNewPasswordToUser(userId, passwordHash);
        } catch (dbErr) {
            console.error('[users] send-password-reset DB update after email', dbErr.message || dbErr);
            return res.status(500).json({
                success: false,
                error: 'Email may have been sent but the password could not be saved. Contact support.'
            });
        }

        res.json({
            success: true,
            message: 'Password reset email sent with a new temporary password.',
            invitationEmailSent: true
        });
    } catch (error) {
        console.error('send-password-reset', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
