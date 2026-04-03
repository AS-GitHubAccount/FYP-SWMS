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

function getFrontendBaseUrl() {
    const u = (process.env.FRONTEND_BASE_URL || process.env.APP_PUBLIC_URL || '').replace(/\/$/, '');
    if (u) return u;
    const port = process.env.PORT || 3000;
    return `http://localhost:${port}`;
}

module.exports = {
    generateInviteToken,
    hashInviteToken,
    defaultInviteExpiry,
    getFrontendBaseUrl
};
