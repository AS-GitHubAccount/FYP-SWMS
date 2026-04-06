const crypto = require('crypto');

function generateInviteToken() {
    return crypto.randomBytes(32).toString('hex');
}

function hashInviteToken(rawToken) {
    return crypto.createHash('sha256').update(String(rawToken), 'utf8').digest('hex');
}

/** Default 7 days */
function defaultInviteExpiry() {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d;
}

/**
 * Base URL for links inside invitation / set-password emails.
 * Forgot-password emails only contain a temp password (no link), so they still "work" when this is wrong —
 * invitation emails embed a set-password URL; if this points at localhost on Railway, the link is unusable.
 */
function getFrontendBaseUrl() {
    const explicit = (process.env.FRONTEND_BASE_URL || process.env.APP_PUBLIC_URL || process.env.PUBLIC_URL || '')
        .trim()
        .replace(/\/$/, '');
    if (explicit) return explicit;

    const railway = String(process.env.RAILWAY_PUBLIC_DOMAIN || '').trim();
    if (railway) {
        const host = railway.replace(/^https?:\/\//i, '').split('/')[0];
        if (host) return `https://${host}`;
    }

    const render = String(process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/$/, '');
    if (render) return render;

    const vercel = String(process.env.VERCEL_URL || '').trim();
    if (vercel) {
        const v = vercel.replace(/^https?:\/\//i, '');
        return `https://${v}`;
    }

    const port = process.env.PORT || 3000;
    return `http://localhost:${port}`;
}

module.exports = {
    generateInviteToken,
    hashInviteToken,
    defaultInviteExpiry,
    getFrontendBaseUrl
};
