// /api/auth
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const {
    hashInviteToken,
    generateInviteToken,
    defaultInviteExpiry,
    getFrontendBaseUrl
} = require('../utils/userInviteTokens');
const { sendEmailWithResult, createSmtpTransport, hasResend } = require('../utils/emailService');
const { requestSelfServicePasswordReset } = require('../utils/passwordResetRequest');

/** Access JWT lifetime (default 1 day). Override with JWT_EXPIRES_IN (e.g. 12h, 1d) and optional JWT_EXPIRES_IN_SEC for API metadata. */
function getAccessTokenExpiry() {
    const expiresIn = process.env.JWT_EXPIRES_IN || '1d';
    const parsed = parseInt(process.env.JWT_EXPIRES_IN_SEC || '86400', 10);
    const expiresInSec = Number.isFinite(parsed) && parsed > 0 ? parsed : 86400;
    return { expiresIn, expiresInSec };
}

router.get('/', (req, res) => {
    res.json({
        message: 'SWMS Authentication API',
        endpoints: {
            login: {
                method: 'POST',
                path: '/api/auth/login',
                description: 'User login',
                body: {
                    email: 'string (required)',
                    role: 'string (required) - ADMIN or STAFF',
                    password: 'string (optional for prototype)'
                }
            },
            register: {
                method: 'POST',
                path: '/api/auth/register',
                description: 'Register new user',
                body: {
                    name: 'string (required)',
                    email: 'string (required)',
                    password: 'string (required)',
                    role: 'string (optional) - ADMIN or STAFF, defaults to STAFF'
                }
            },
            testEmail: {
                method: 'GET or POST',
                path: '/api/auth/test-email?to=your@email.com',
                description: 'Test SMTP - send a test email (diagnostics)'
            },
            completeInvitation: {
                method: 'POST',
                path: '/api/auth/complete-invitation',
                description: 'Set password from email invitation/reset token (ADMIN-issued)',
                body: { token: 'string', newPassword: 'string (min 6)' }
            },
            forgotPassword: {
                method: 'POST',
                path: '/api/auth/forgot-password',
                description:
                    'Self-service: if email, name, and role match, email a new password and update stored hash (interim-report flow)',
                body: {
                    email: 'string (required)',
                    name: 'string (required — must match account)',
                    role: 'string (required: ADMIN or STAFF — must match account)'
                }
            }
        }
    });
});

// Demo users for when database is unavailable (MySQL not running / wrong credentials)
const DEMO_USERS = [
    { userId: 1, name: 'Admin User', email: 'admin@swms.com', password: 'password', role: 'ADMIN' },
    { userId: 2, name: 'Staff User', email: 'staff@swms.com', password: 'password', role: 'STAFF' }
];

function isDbError(err) {
    const codes = ['ER_ACCESS_DENIED_ERROR', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'ER_BAD_DB_ERROR'];
    return err && (codes.includes(err.code) || (err.code && String(err.code).startsWith('ER_')));
}

router.post('/login', async (req, res) => {
    try {
        const { email, password, role } = req.body;
        
        // Validate required fields
        if (!email || !password || !role) {
            return res.status(400).json({ 
                success: false,
                error: 'Email, password, and role are required' 
            });
        }
        
        const requestedRole = (role === 'Administrator' ? 'ADMIN' : role === 'Warehouse Staff' ? 'STAFF' : role).toUpperCase();
        let user = null;
        
        try {
            // Try to find user in database
            const [users] = await db.execute(
                'SELECT * FROM users WHERE email = ?',
                [email.toLowerCase()]
            );
            
            if (users.length > 0) {
                user = users[0];
                if (!user.passwordHash) {
                    return res.status(403).json({
                        success: false,
                        error: 'invitation_pending',
                        message:
                            'You must set your password using the link sent to your email before signing in. Ask an admin to resend the invitation if needed.'
                    });
                }
                const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
                if (!isPasswordValid) {
                    return res.status(401).json({ success: false, error: 'Incorrect password' });
                }
                const userRole = (user.role || '').toUpperCase();
                if (requestedRole !== userRole) {
                    return res.status(403).json({ success: false, error: 'Incorrect position' });
                }
            }
        } catch (dbErr) {
            if (!isDbError(dbErr)) throw dbErr;
            // Database unavailable - use demo login fallback
            console.log('[Login] Database unavailable, using demo credentials');
            const demo = DEMO_USERS.find(u => u.email.toLowerCase() === email.toLowerCase());
            if (demo) {
                if (demo.password !== password) {
                    return res.status(401).json({ success: false, error: 'Incorrect password' });
                }
                if (demo.role !== requestedRole) {
                    return res.status(403).json({ success: false, error: 'Incorrect position' });
                }
                user = demo;
            }
        }
        
        if (!user) {
            return res.status(401).json({ 
                success: false,
                error: 'Incorrect email address'
            });
        }

        const { expiresIn: accessExpiresIn, expiresInSec: accessExpiresSec } = getAccessTokenExpiry();

        const token = jwt.sign(
            { userId: user.userId, email: user.email, role: user.role },
            process.env.JWT_SECRET || 'secret_key',
            { expiresIn: accessExpiresIn }
        );
        const refreshToken = jwt.sign(
            { userId: user.userId, type: 'refresh' },
            process.env.JWT_SECRET || 'secret_key',
            { expiresIn: '7d' }
        );

        // Persist refresh token so POST /auth/refresh can validate (was missing — refresh always failed → expired access JWT on protected actions).
        try {
            const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
            await db.execute('DELETE FROM refresh_tokens WHERE userId = ?', [user.userId]);
            await db.execute(
                'INSERT INTO refresh_tokens (userId, token, expiresAt) VALUES (?, ?, ?)',
                [user.userId, refreshToken, expiresAt]
            );
        } catch (persistErr) {
            console.warn('[Login] Could not persist refresh token (table missing or DB error):', persistErr.message);
        }
        
        res.json({
            success: true,
            message: 'Login successful',
            data: {
                token,
                refreshToken,
                expiresIn: accessExpiresSec,
                user: {
                    userId: user.userId,
                    name: user.name,
                    email: user.email,
                    role: user.role
                }
            }
        });
    } catch (error) {
        console.error('Error during login:', error);
        res.status(500).json({ 
            success: false,
            error: 'Login failed',
            message: error.message 
        });
    }
});

router.post('/refresh', async (req, res) => {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) return res.status(400).json({ success: false, error: 'refreshToken required' });
        const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET || 'secret_key');
        if (decoded.type !== 'refresh') return res.status(401).json({ success: false, error: 'Invalid token' });
        const [rows] = await db.execute(
            'SELECT * FROM refresh_tokens WHERE userId = ? AND token = ? AND expiresAt > NOW()',
            [decoded.userId, refreshToken]
        );
        if (!rows.length) return res.status(401).json({ success: false, error: 'Token expired or invalid' });
        const [users] = await db.execute('SELECT * FROM users WHERE userId = ?', [decoded.userId]);
        if (!users.length) return res.status(401).json({ success: false, error: 'User not found' });
        const user = users[0];
        const { expiresIn: accessExpiresIn, expiresInSec: accessExpiresSec } = getAccessTokenExpiry();

        const token = jwt.sign(
            { userId: user.userId, email: user.email, role: user.role },
            process.env.JWT_SECRET || 'secret_key',
            { expiresIn: accessExpiresIn }
        );
        res.json({ success: true, data: { token, expiresIn: accessExpiresSec } });
    } catch (e) {
        res.status(401).json({ success: false, error: 'Invalid or expired refresh token' });
    }
});

router.post('/register', async (req, res) => {
    try {
        const { name, email, password, role } = req.body;
        
        // Validate required fields
        if (!name || !email || !password) {
            return res.status(400).json({ 
                success: false,
                error: 'Name, email, and password are required' 
            });
        }
        
        // Check if user already exists
        const [existing] = await db.execute(
            'SELECT * FROM users WHERE email = ?',
            [email]
        );
        
        if (existing.length > 0) {
            return res.status(400).json({ 
                success: false,
                error: 'User with this email already exists' 
            });
        }
        
        // Hash password
        const passwordHash = await bcrypt.hash(password, 10);
        
        // Insert new user
        const [result] = await db.execute(
            `INSERT INTO users (name, email, passwordHash, role) 
             VALUES (?, ?, ?, ?)`,
            [
                name,
                email,
                passwordHash,
                (role || 'STAFF').toUpperCase()
            ]
        );
        
        // Get created user
        const [newUser] = await db.execute(
            'SELECT userId, name, email, role, createdAt FROM users WHERE userId = ?',
            [result.insertId]
        );
        
        res.status(201).json({
            success: true,
            message: 'User registered successfully',
            data: newUser[0]
        });
    } catch (error) {
        console.error('Error during registration:', error);
        res.status(500).json({ 
            success: false,
            error: 'Registration failed',
            message: error.message 
        });
    }
});

router.post('/forgot-password', async (req, res) => {
    try {
        const body = req.body || {};
        const email = body.email;
        const result = await requestSelfServicePasswordReset(email, { name: body.name, role: body.role });
        if (!result.success) {
            return res.status(400).json(result);
        }
        res.json({ success: true, message: result.message });
    } catch (error) {
        console.error('POST /auth/forgot-password', error);
        res.status(500).json({
            success: false,
            error: 'Something went wrong. Please try again later.'
        });
    }
});

router.all('/test-email', async (req, res) => {
    const to = req.body?.to || req.query?.to;
    if (!to) {
        return res.status(400).json({ success: false, error: 'Provide ?to=your@email.com or body: { to: "your@email.com" }' });
    }
    if (hasResend()) {
        const r = await sendEmailWithResult({
            to,
            subject: 'SWMS - Test Email',
            text: 'If you receive this, email (Resend) is working.',
            html: '<p>If you receive this, email (Resend) is working.</p>'
        });
        if (!r.ok) {
            return res.status(500).json({ success: false, error: r.userMessage || 'Resend send failed' });
        }
        return res.json({
            success: true,
            message: 'Test email sent via Resend. Check inbox and spam.',
            diagnostics: { via: 'resend' }
        });
    }
    const transporter = createSmtpTransport();
    if (!transporter) {
        return res.json({
            success: false,
            error: 'Email not configured. Set RESEND_API_KEY (Railway-friendly) or SMTP_USER + SMTP_PASS in .env'
        });
    }
    try {
        await transporter.verify();
        const fromUser = process.env.SMTP_USER;
        const info = await transporter.sendMail({
            from: `"SWMS Test" <${fromUser}>`,
            to,
            subject: 'SWMS - Test Email',
            text: 'If you receive this, SMTP is working.'
        });
        return res.json({
            success: true,
            message: 'Test email sent. Check inbox and spam.',
            diagnostics: {
                messageId: info.messageId,
                accepted: info.accepted,
                rejected: info.rejected,
                host: process.env.SMTP_HOST || 'smtp.gmail.com',
                port: parseInt(process.env.SMTP_PORT || '587', 10),
                via: 'smtp'
            }
        });
    } catch (err) {
        console.error('Test email error:', err);
        return res.status(500).json({
            success: false,
            error: err.message,
            full: err.toString()
        });
    }
});

router.get('/invitation-preview', async (req, res) => {
    try {
        const token = (req.query.token || '').trim();
        if (!token) {
            return res.status(400).json({ success: false, error: 'token required' });
        }
        const hash = hashInviteToken(token);
        const [rows] = await db.execute(
            `SELECT userId, email, name FROM users WHERE inviteTokenHash = ? AND (inviteTokenExpires IS NULL OR inviteTokenExpires > NOW())`,
            [hash]
        );
        if (!rows.length) {
            return res.json({ success: true, valid: false });
        }
        const em = rows[0].email || '';
        const masked = em.length > 3 ? `${em[0]}***${em.slice(em.indexOf('@'))}` : '***';
        res.json({ success: true, valid: true, emailHint: masked });
    } catch (error) {
        console.error('invitation-preview', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/complete-invitation', async (req, res) => {
    try {
        const { token, newPassword } = req.body || {};
        if (!token || !newPassword || String(newPassword).length < 6) {
            return res.status(400).json({
                success: false,
                error: 'token and newPassword (min 6 characters) are required'
            });
        }
        const hash = hashInviteToken(String(token).trim());
        const [users] = await db.execute(
            `SELECT * FROM users WHERE inviteTokenHash = ? AND (inviteTokenExpires IS NULL OR inviteTokenExpires > NOW())`,
            [hash]
        );
        if (!users.length) {
            return res.status(400).json({
                success: false,
                error: 'invalid_or_expired_token',
                message: 'This link is invalid or has expired. Ask your administrator for a new invitation or reset email.'
            });
        }
        const passwordHash = await bcrypt.hash(newPassword, 10);
        try {
            await db.execute(
                `UPDATE users SET passwordHash = ?, inviteTokenHash = NULL, inviteTokenExpires = NULL,
           accountStatus = 'ACTIVE' WHERE userId = ?`,
                [passwordHash, users[0].userId]
            );
        } catch (e) {
            if (e.code === 'ER_BAD_FIELD_ERROR') {
                await db.execute(
                    `UPDATE users SET passwordHash = ?, inviteTokenHash = NULL, inviteTokenExpires = NULL WHERE userId = ?`,
                    [passwordHash, users[0].userId]
                );
            } else throw e;
        }
        res.json({ success: true, message: 'Your password has been set. You can sign in now.' });
    } catch (error) {
        console.error('complete-invitation', error);
        res.status(500).json({ success: false, error: 'Failed to set password', message: error.message });
    }
});

module.exports = router;

