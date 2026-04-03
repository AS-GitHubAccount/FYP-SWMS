/**
 * Email Service - Enhancement #4
 * Sends emails for alerts, approvals, rejections
 */
const nodemailer = require('nodemailer');

let transporter = null;

/**
 * Build nodemailer options for SMTP (Gmail / Google Workspace / Outlook, etc.).
 * Port 465 + secure=true uses implicit TLS (often works when 587 + STARTTLS is blocked on campus Wi‑Fi).
 */
function buildSmtpTransportOptions() {
    const host = (process.env.SMTP_HOST || 'smtp.gmail.com').trim();
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    const secure = process.env.SMTP_SECURE === 'true' || port === 465;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (!user || !pass) return null;

    const opts = {
        host,
        port,
        secure,
        auth: { user, pass },
        connectionTimeout: 60000,
        greetingTimeout: 60000,
        socketTimeout: 120000,
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

/** New transport (no cache) — use for tests or after env change */
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

async function sendEmail(to, subject, html, text) {
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

async function sendEmailWithOptions(options) {
    const transport = getTransporter();
    if (!transport) return false;
    try {
        await transport.sendMail({
            from: `"SWMS" <${process.env.SMTP_USER}>`,
            to: options.to,
            cc: options.cc || undefined,
            bcc: options.bcc || undefined,
            replyTo: options.replyTo || undefined,
            subject: options.subject,
            html: options.html || undefined,
            text: options.text || (options.html ? options.html.replace(/<[^>]+>/g, ' ') : undefined)
        });
        return true;
    } catch (e) {
        console.error('[emailService]', e.message);
        return false;
    }
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
    notifyAdminsByEmail,
    getTransporter,
    createSmtpTransport,
    buildSmtpTransportOptions
};
