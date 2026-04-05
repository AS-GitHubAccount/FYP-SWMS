// nodemailer wrapper; optional Resend HTTPS API for hosts that block SMTP (e.g. Railway Hobby).
const nodemailer = require('nodemailer');
const dns = require('dns');

let transporter = null;

try {
    if (typeof dns.setDefaultResultOrder === 'function' && process.env.SMTP_PREFER_IPV4 !== 'false') {
        dns.setDefaultResultOrder('ipv4first');
    }
} catch (_) {
    /* ignore */
}

function smtpTimeoutMs(envKey, defaultVal) {
    const n = parseInt(process.env[envKey] || String(defaultVal), 10);
    return Number.isFinite(n) && n >= 3000 ? n : defaultVal;
}

function hasResend() {
    return !!String(process.env.RESEND_API_KEY || '').trim();
}

/** True when using Resend's unverified test From — API only delivers to the account owner's email. */
function isResendRestrictedTestSender() {
    if (!hasResend()) return false;
    const raw = String(process.env.RESEND_FROM || 'onboarding@resend.dev').trim();
    const lower = raw.toLowerCase();
    const angle = lower.match(/<([^>]+)>/);
    const addr = (angle ? angle[1] : lower).trim();
    return addr === 'onboarding@resend.dev';
}

function augmentResendApiErrorMessage(apiMessage) {
    const base = typeof apiMessage === 'string' ? apiMessage : String(apiMessage || '');
    if (!base.trim()) return base;
    if (!/only send testing emails|verify a domain/i.test(base)) return base;
    return (
        `${base.trim()} ` +
        'Hint: with sender onboarding@resend.dev, Resend allows only your Resend signup email in To, CC, and BCC. ' +
        'For real recipients, verify a domain at https://resend.com/domains and set RESEND_FROM to an address on that domain (e.g. on Railway Variables).'
    );
}

function parseEmailList(s) {
    if (s == null || s === '') return undefined;
    if (Array.isArray(s)) return s.map((x) => String(x).trim()).filter(Boolean);
    return String(s)
        .split(/[,;]/)
        .map((x) => x.trim())
        .filter(Boolean);
}

/**
 * Merge comma/semicolon-separated reply-to fragments into one de-duplicated list (preserves first-seen casing).
 * @param {...(string|undefined|null)} parts e.g. client header + MAIL_REPLY_TO_EXTRA
 * @returns {string|undefined} comma-separated for nodemailer, or undefined if empty
 */
function mergeReplyToParts(...parts) {
    const seen = new Set();
    const out = [];
    for (const p of parts) {
        const list = parseEmailList(p);
        if (!list) continue;
        for (const e of list) {
            const k = e.toLowerCase();
            if (!seen.has(k)) {
                seen.add(k);
                out.push(e);
            }
        }
    }
    return out.length ? out.join(', ') : undefined;
}

/**
 * True if the app can attempt outbound mail (SMTP credentials or Resend API key).
 */
function isOutboundEmailConfigured() {
    if (hasResend()) return true;
    return !!buildSmtpTransportOptions();
}

function buildSmtpTransportOptions() {
    const host = (process.env.SMTP_HOST || 'smtp.gmail.com').trim();
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    const secure = process.env.SMTP_SECURE === 'true' || port === 465;
    const user = process.env.SMTP_USER ? String(process.env.SMTP_USER).trim() : '';
    const passRaw = process.env.SMTP_PASS != null ? String(process.env.SMTP_PASS) : '';
    const pass = passRaw.replace(/\s+/g, '');
    if (!user || !pass) return null;

    const connectionTimeout = smtpTimeoutMs('SMTP_CONNECTION_TIMEOUT_MS', 20000);
    const greetingTimeout = smtpTimeoutMs('SMTP_GREETING_TIMEOUT_MS', 15000);
    const socketTimeout = smtpTimeoutMs('SMTP_SOCKET_TIMEOUT_MS', 45000);

    const opts = {
        host,
        port,
        secure,
        auth: { user, pass },
        connectionTimeout,
        greetingTimeout,
        socketTimeout,
        tls: {
            minVersion: 'TLSv1.2',
            servername: host
        }
    };
    if (!secure) {
        opts.requireTLS = true;
    }
    return opts;
}

function createSmtpTransport() {
    const opts = buildSmtpTransportOptions();
    if (!opts) return null;
    return nodemailer.createTransport(opts);
}

function getTransporter() {
    if (transporter) return transporter;
    const opts = buildSmtpTransportOptions();
    if (!opts) return null;
    transporter = nodemailer.createTransport(opts);
    return transporter;
}

/**
 * Resend over HTTPS — works on Railway Free/Hobby where outbound SMTP 465/587 is often blocked.
 * @see https://resend.com/docs/api-reference/emails/send-email
 */
async function sendViaResend(options) {
    const key = String(process.env.RESEND_API_KEY || '').trim();
    if (!key) return { ok: false, userMessage: 'RESEND_API_KEY is empty.' };

    const fromRaw = (process.env.RESEND_FROM || 'onboarding@resend.dev').trim();
    const from = fromRaw.includes('<') ? fromRaw : `SWMS <${fromRaw}>`;

    const recipients = parseEmailList(options.to);
    if (!recipients || !recipients.length) {
        return { ok: false, userMessage: 'No email recipients.' };
    }

    const payload = {
        from,
        to: recipients,
        subject: options.subject || '(no subject)',
        html: options.html || undefined,
        text:
            options.text ||
            (options.html ? String(options.html).replace(/<[^>]+>/g, ' ') : undefined)
    };
    const cc = parseEmailList(options.cc);
    const bcc = parseEmailList(options.bcc);
    if (cc && cc.length) payload.cc = cc;
    if (bcc && bcc.length) payload.bcc = bcc;
    const replyList = parseEmailList(options.replyTo);
    if (replyList && replyList.length) {
        payload.reply_to = replyList;
    }

    const fetchTimeoutMs = parseInt(process.env.RESEND_FETCH_TIMEOUT_MS || '20000', 10);
    const safeTimeout = Number.isFinite(fetchTimeoutMs) && fetchTimeoutMs >= 5000 ? fetchTimeoutMs : 20000;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), safeTimeout);
    try {
        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${key}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload),
            signal: ctrl.signal
        });
        clearTimeout(timer);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            const msg = data.message || (data.error && (data.error.message || data.error)) || JSON.stringify(data);
            const str = typeof msg === 'string' ? msg : JSON.stringify(msg);
            const augmented = augmentResendApiErrorMessage(str);
            return {
                ok: false,
                userMessage: `Resend: ${augmented.slice(0, 600)}`,
                raw: JSON.stringify(data).slice(0, 400)
            };
        }
        return { ok: true };
    } catch (e) {
        clearTimeout(timer);
        const aborted = e && (e.name === 'AbortError' || /aborted|AbortError/i.test(String(e.message || e)));
        if (aborted) {
            return {
                ok: false,
                userMessage: `Resend API did not respond within ${safeTimeout}ms. Check Railway logs and that outbound HTTPS to api.resend.com is allowed. If the server has no RESEND_API_KEY it may be falling back to SMTP (slow).`,
                raw: 'timeout'
            };
        }
        return {
            ok: false,
            userMessage: e.message || 'Resend request failed',
            raw: String(e).slice(0, 300)
        };
    }
}

async function sendEmail(to, subject, html, text) {
    if (hasResend()) {
        const r = await sendEmailWithResult({ to, subject, html, text });
        return r.ok;
    }
    const transport = getTransporter();
    if (!transport) return false;
    try {
        await transport.sendMail({
            from: `"SWMS" <${process.env.SMTP_USER}>`,
            to,
            subject,
            html: html || text,
            text
        });
        return true;
    } catch (e) {
        console.error('[emailService]', e.message);
        return false;
    }
}

/**
 * @returns {{ ok: true } | { ok: false, userMessage: string, raw?: string }}
 */
function mapSmtpFailureToUserMessage(err) {
    if (!err) return { ok: false, userMessage: 'Unknown error' };
    const msg = String(err.message || err);
    const lower = msg.toLowerCase();
    const code = err.code || err.responseCode;
    console.error('[emailService] sendMail failed:', code || '', msg);
    if (/etimedout|esockettimedout|timeout|timed out|greeting not received|connection timeout/i.test(lower) || code === 'ETIMEDOUT') {
        return {
            ok: false,
            userMessage:
                'SMTP connection timed out. Railway Free/Hobby often blocks outbound SMTP ports 465/587 — use Resend instead: set RESEND_API_KEY (HTTPS, no SMTP). Or upgrade Railway to a plan that allows SMTP. Also remove spaces from Gmail App Passwords in SMTP_PASS.',
            raw: msg.slice(0, 300)
        };
    }
    if (/econnrefused|econnreset|enotfound|getaddrinfo|eai_again/i.test(lower) || code === 'ECONNREFUSED') {
        return {
            ok: false,
            userMessage: 'Cannot reach the SMTP server. Check SMTP_HOST and SMTP_PORT in environment variables.',
            raw: msg.slice(0, 300)
        };
    }
    if (/invalid login|535|authentication failed|bad credentials|534|5\.7\.0/i.test(lower)) {
        return {
            ok: false,
            userMessage:
                'SMTP login was rejected. For Gmail/Workspace use an App Password (16 characters, no spaces). Ensure 2FA is on.',
            raw: msg.slice(0, 300)
        };
    }
    return { ok: false, userMessage: msg.split('\n')[0].slice(0, 220), raw: msg.slice(0, 300) };
}

async function sendEmailWithResult(options) {
    if (hasResend()) {
        return sendViaResend(options);
    }

    const transport = getTransporter();
    if (!transport) {
        return {
            ok: false,
            userMessage:
                'No email transport: set RESEND_API_KEY (recommended on Railway) or SMTP_USER + SMTP_PASS for SMTP.'
        };
    }
    try {
        const user = process.env.SMTP_USER ? String(process.env.SMTP_USER).trim() : '';
        const replyListSmtp = parseEmailList(options.replyTo);
        const replyToSmtp =
            replyListSmtp && replyListSmtp.length === 1
                ? replyListSmtp[0]
                : replyListSmtp && replyListSmtp.length > 1
                  ? replyListSmtp
                  : undefined;
        await transport.sendMail({
            from: `"SWMS" <${user}>`,
            to: options.to,
            cc: options.cc || undefined,
            bcc: options.bcc || undefined,
            replyTo: replyToSmtp,
            subject: options.subject,
            html: options.html || undefined,
            text: options.text || (options.html ? options.html.replace(/<[^>]+>/g, ' ') : undefined)
        });
        return { ok: true };
    } catch (e) {
        return mapSmtpFailureToUserMessage(e);
    }
}

async function sendEmailWithOptions(options) {
    const r = await sendEmailWithResult(options);
    return r.ok;
}

async function notifyAdminsByEmail(subject, message) {
    const db = require('../config/database');
    const [admins] = await db.execute("SELECT email FROM users WHERE role = 'ADMIN'");
    const sent = [];
    for (const a of admins) {
        if (a.email) {
            const ok = await sendEmail(a.email, subject, `<p>${message.replace(/\n/g, '<br>')}</p>`, message);
            if (ok) sent.push(a.email);
        }
    }
    return sent;
}

module.exports = {
    sendEmail,
    sendEmailWithOptions,
    sendEmailWithResult,
    notifyAdminsByEmail,
    getTransporter,
    createSmtpTransport,
    buildSmtpTransportOptions,
    isOutboundEmailConfigured,
    hasResend,
    isResendRestrictedTestSender,
    mergeReplyToParts
};
