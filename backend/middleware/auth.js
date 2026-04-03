/**
 * Authentication Middleware
 * Verifies JWT token on protected routes.
 */

const jwt = require('jsonwebtoken');

/** Bearer from Authorization, or raw JWT in x-access-token (some proxies strip Authorization). */
function extractBearerToken(req) {
    const raw = req.headers.authorization || req.headers.Authorization;
    if (raw && typeof raw === 'string') {
        const m = /^Bearer\s+(\S+)/i.exec(String(raw).trim());
        if (m && m[1]) return m[1].trim();
    }
    const x = req.headers['x-access-token'] || req.headers['X-Access-Token'];
    if (x && String(x).trim()) return String(x).trim();
    return null;
}

function authMiddleware(req, res, next) {
    // CORS library usually ends OPTIONS before this; if not, never 401 a preflight.
    if (req.method === 'OPTIONS') {
        return next();
    }

    const token = extractBearerToken(req);

    if (!token) {
        return res.status(401).json({
            success: false,
            error: 'Authentication required',
            message: 'No token provided'
        });
    }
    
    const secret = process.env.JWT_SECRET;
    if (!secret || secret === 'secret_key') {
        console.error('JWT_SECRET not set or using default - configure in .env');
    }
    
    try {
        const decoded = jwt.verify(token, secret || 'secret_key');
        req.user = decoded;  // { userId, email, role }
        next();
    } catch (err) {
        return res.status(401).json({
            success: false,
            error: 'Invalid or expired token',
            message: err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token'
        });
    }
}

/**
 * Admin-only middleware. Must be used after authMiddleware.
 * Returns 403 if user is not Admin.
 */
function requireAdmin(req, res, next) {
    const role = (req.user && req.user.role) ? String(req.user.role).toUpperCase() : '';
    if (role !== 'ADMIN') {
        return res.status(403).json({
            success: false,
            error: 'Admin access required',
            message: 'This action is restricted to administrators'
        });
    }
    next();
}

/** Optional auth: verify token if present, but allow request through if no token (req.user may be null) */
function optionalAuth(req, res, next) {
    if (req.method === 'OPTIONS') {
        return next();
    }
    const token = extractBearerToken(req);
    if (!token) {
        req.user = null;
        return next();
    }
    const secret = process.env.JWT_SECRET;
    try {
        const decoded = jwt.verify(token, secret || 'secret_key');
        req.user = decoded;
    } catch (err) {
        req.user = null;
    }
    next();
}

module.exports = { authMiddleware, requireAdmin, optionalAuth };
