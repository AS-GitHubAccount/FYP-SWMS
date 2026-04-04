/**
 * SWMS Backend Server
 * 
 * This is the main entry point for your backend API.
 * It starts the Express server and sets up all routes.
 */

const http = require('http');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Import database connection
const db = require('./config/database');

// Enhancement #5: Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 min
    max: Number(process.env.RATE_LIMIT_MAX || 600),
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many requests, try again later' },
    skip: (req) => {
        // In prototype mode, don't rate-limit GETs from the UI.
        if (req.method === 'GET' && req.path.startsWith('/api/')) return true;
        if (req.path === '/api/health' || req.path === '/health' || req.path === '/live') return true;
        return false;
    }
});

// Import routes
const productsRoutes = require('./routes/products');
const authRoutes = require('./routes/auth');
const inventoryRoutes = require('./routes/inventory');
const usersRoutes = require('./routes/users');
const batchesRoutes = require('./routes/batches');
const receivingRoutes = require('./routes/receiving');
const issuingRoutes = require('./routes/issuing');
const alertsRoutes = require('./routes/alerts');
const bookingsRoutes = require('./routes/bookings');
const notificationsRoutes = require('./routes/notifications');
const auditRoutes = require('./routes/audit');
const wizardRoutes = require('./routes/wizard');
const suppliersRoutes = require('./routes/suppliers');
const purchaseRequestsRoutes = require('./routes/purchaseRequests');
const rfqsRoutes = require('./routes/rfqs');
const purchaseOrdersRoutes = require('./routes/purchaseOrders');
const priceHistoryRoutes = require('./routes/priceHistory');
const purchasingUploadsRoutes = require('./routes/purchasingUploads');
const purchasingRoutes = require('./routes/purchasing');
const disposalRequestsRoutes = require('./routes/disposalRequests');
const stockAdjustmentsRoutes = require('./routes/stockAdjustments');
const dashboardRoutes = require('./routes/dashboard');
const settingsRoutes = require('./routes/settings');
const { startDailyAlertsJob } = require('./jobs/dailyAlerts');
const { startMinuteAlertsJob } = require('./jobs/minuteAlerts');
const { authMiddleware, optionalAuth } = require('./middleware/auth');

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// MIDDLEWARE (runs before routes)
// ============================================

// CORS - Allow frontend to call this API
app.use(cors({
    // Allow all origins including `null` (file://) during prototyping.
    // In production, lock this down to your deployed frontend origin.
    origin: function(origin, callback) {
        callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
        'Content-Type',
        'Authorization',
        'Cache-Control',
        'Pragma',
        'X-Access-Token'
    ]
}));

// Parse JSON request bodies
app.use(express.json());

// Parse URL-encoded request bodies
app.use(express.urlencoded({ extended: true }));

// Rate limiting on API routes
app.use('/api/', limiter);

// Serve static files
const prototypesPath = path.resolve(__dirname, '..', 'prototypes');
const publicPath = path.join(__dirname, 'public');

// ============================================
// API ROUTES (must be before static to avoid 404 on /api/*)
// ============================================

// API Documentation UI - serve HTML for browsers, JSON for API calls
app.get('/', (req, res) => {
    // Check Accept header - browsers send text/html, API clients send application/json
    const acceptHeader = req.get('Accept') || '';
    const isBrowser = acceptHeader.includes('text/html') || 
                      acceptHeader.includes('*/*') ||
                      (!acceptHeader.includes('application/json') && !req.query.json);
    
    if (isBrowser && !req.query.json) {
        // Browser request - serve HTML
        const htmlPath = path.resolve(__dirname, 'public', 'api-docs.html');
        res.sendFile(htmlPath, (err) => {
            if (err) {
                console.error('Error sending api-docs.html:', err);
                // Fallback to JSON if HTML fails
                res.json({ 
                    message: 'SWMS Backend API is running! 🚀',
                    version: '1.0.0',
                    error: 'Documentation UI not available',
                    endpoints: {
                        products: '/api/products',
                        auth: '/api/auth',
                        inventory: '/api/inventory (unified: includes bookings, issuing, receiving)',
                        'inventory-bookings': '/api/inventory/bookings',
                        'inventory-issuing': '/api/inventory/issuing',
                        'inventory-receiving': '/api/inventory/receiving',
                        users: '/api/users',
                        batches: '/api/batches',
                        receiving: '/api/receiving (legacy - use /api/inventory/receiving)',
                        issuing: '/api/issuing (legacy - use /api/inventory/issuing)',
                        alerts: '/api/alerts',
                        bookings: '/api/bookings (legacy - use /api/inventory/bookings)',
                        notifications: '/api/notifications',
                        audit: '/api/audit',
                        wizard: '/api/wizard'
                    }
                });
            }
        });
    } else {
        // API request - serve JSON
        res.json({ 
            message: 'SWMS Backend API is running! 🚀',
            version: '1.0.0',
            documentation: 'Visit http://localhost:3000/ in a browser for UI documentation',
            endpoints: {
                products: '/api/products',
                auth: '/api/auth',
                inventory: '/api/inventory (unified: includes bookings, issuing, receiving)',
                'inventory-bookings': '/api/inventory/bookings',
                'inventory-issuing': '/api/inventory/issuing',
                'inventory-receiving': '/api/inventory/receiving',
                users: '/api/users',
                batches: '/api/batches',
                receiving: '/api/receiving (legacy - use /api/inventory/receiving)',
                issuing: '/api/issuing (legacy - use /api/inventory/issuing)',
                alerts: '/api/alerts',
                bookings: '/api/bookings (legacy - use /api/inventory/bookings)',
                notifications: '/api/notifications',
                audit: '/api/audit',
                wizard: '/api/wizard'
            }
        });
    }
});

// API Documentation route (alternative access)
app.get('/api-docs', (req, res) => {
    console.log('📄 /api-docs route hit');
    const htmlPath = path.resolve(__dirname, 'public', 'api-docs.html');
    console.log('📄 Sending file from:', htmlPath);
    res.sendFile(htmlPath, (err) => {
        if (err) {
            console.error('Error sending api-docs.html:', err);
            res.status(500).json({ error: 'Failed to load documentation', message: err.message });
        }
    });
});

// Explicit route for api-docs.html
app.get('/api-docs.html', (req, res) => {
    console.log('📄 /api-docs.html route hit');
    const htmlPath = path.resolve(__dirname, 'public', 'api-docs.html');
    console.log('📄 Sending file from:', htmlPath);
    res.sendFile(htmlPath, (err) => {
        if (err) {
            console.error('Error sending api-docs.html:', err);
            res.status(500).json({ error: 'Failed to load documentation', message: err.message });
        }
    });
});

// Liveness for load balancers / PaaS (no DB — avoids failed deploys when DB vars are still being set)
app.get('/live', (req, res) => {
    res.status(200).json({ status: 'alive', timestamp: new Date().toISOString() });
});

// Health check with database status
app.get('/health', async (req, res) => {
    try {
        const dbConnected = await db.testConnection();
        res.json({
            status: 'ok',
            database: dbConnected ? 'connected' : 'disconnected',
            dbHost: process.env.DB_HOST,
            dbName: process.env.DB_NAME,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            database: 'error',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Test Email (SMTP diagnostics) - must be BEFORE /api/auth so it matches first
// Also available at /api/test-smtp in case of path conflicts
const { createSmtpTransport } = require('./utils/emailService');
const handleTestEmail = async (req, res) => {
    const to = req.body?.to || req.query?.to;
    if (!to) return res.status(400).json({ success: false, error: 'Provide ?to=your@email.com' });
    const t = createSmtpTransport();
    if (!t) return res.json({ success: false, error: 'SMTP not configured. Set SMTP_USER and SMTP_PASS in .env' });
    const fromUser = process.env.SMTP_USER;
    try {
        await t.verify();
        const info = await t.sendMail({ from: `"SWMS Test" <${fromUser}>`, to, subject: 'SWMS - Test Email', text: 'If you receive this, SMTP is working.' });
        return res.json({ success: true, message: 'Test email sent. Check inbox and spam.', diagnostics: { messageId: info.messageId, accepted: info.accepted } });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
};
app.all('/api/auth/test-email', handleTestEmail);
app.all('/api/test-smtp', handleTestEmail);

// GET /api - API info (avoids 404 when visiting http://localhost:3000/api)
app.get('/api', (req, res) => {
    res.json({
        message: 'SWMS Backend API is running!',
        version: '1.0.0',
        endpoints: {
            auth: '/api/auth',
            products: '/api/products',
            inventory: '/api/inventory',
            users: '/api/users',
            bookings: '/api/inventory/bookings',
            login: 'http://localhost:3000/login.html'
        }
    });
});

// API Routes - auth required for all except /api/auth
app.use('/api/auth', authRoutes);
// Scan with optionalAuth (works when token missing/expired - e.g. scanning from different device)
const parseScanPayload = inventoryRoutes.parseScanPayload;
const handleScanRequest = inventoryRoutes.handleScanRequest;
function scanHandler(req, res) {
    let text = '';
    if (req.method === 'POST' && req.body && req.body.payload) {
        text = String(req.body.payload);
    } else if (req.method === 'GET' && req.params && req.params.payload) {
        try { text = decodeURIComponent(req.params.payload); } catch (e) { return res.status(400).json({ success: false, error: 'Invalid QR payload encoding' }); }
    }
    const decoded = parseScanPayload(text);
    if (!decoded) return res.status(400).json({ success: false, error: 'Invalid QR payload' });
    return handleScanRequest(decoded, res);
}
app.post('/api/inventory/scan', optionalAuth, scanHandler);
app.get('/api/inventory/scan/:payload', optionalAuth, scanHandler);
// Fallback: /api/scan for clients that use the shorter path
app.post('/api/scan', optionalAuth, (req, res) => {
    const text = req.body && req.body.payload ? String(req.body.payload) : '';
    const decoded = parseScanPayload(text);
    if (!decoded) return res.status(400).json({ success: false, error: 'Invalid QR payload' });
    return handleScanRequest(decoded, res);
});
app.get('/api/scan/:payload', optionalAuth, (req, res) => {
    let text;
    try { text = decodeURIComponent(req.params.payload); } catch (e) { return res.status(400).json({ success: false, error: 'Invalid QR payload encoding' }); }
    const decoded = parseScanPayload(text);
    if (!decoded) return res.status(400).json({ success: false, error: 'Invalid QR payload' });
    return handleScanRequest(decoded, res);
});
// Batches and products first (so /api/batches/:id/qr and /api/products/:id/qr are matched before any catch-alls)
app.use('/api/batches', authMiddleware, batchesRoutes);
app.use('/api/products', authMiddleware, productsRoutes);
app.use('/api/inventory', authMiddleware, inventoryRoutes);
app.use('/api/users', authMiddleware, usersRoutes);
app.use('/api/receiving', authMiddleware, receivingRoutes);
app.use('/api/issuing', authMiddleware, issuingRoutes);
app.use('/api/alerts', optionalAuth, alertsRoutes);
app.use('/api/bookings', authMiddleware, bookingsRoutes);
// Notifications use optionalAuth so prototype pages can still load inbox even if token is missing.
app.use('/api/notifications', optionalAuth, notificationsRoutes);
app.use('/api/audit', authMiddleware, auditRoutes);
app.use('/api/wizard', authMiddleware, wizardRoutes);
app.use('/api/suppliers', authMiddleware, suppliersRoutes);
app.use('/api/purchase-requests', authMiddleware, purchaseRequestsRoutes);
app.use('/api/rfqs', authMiddleware, rfqsRoutes);
app.use('/api/purchase-orders', authMiddleware, purchaseOrdersRoutes);
app.use('/api/price-history', authMiddleware, priceHistoryRoutes);
app.use('/api/purchasing', authMiddleware, purchasingRoutes);
app.use('/api/purchasing-uploads', authMiddleware, purchasingUploadsRoutes);
app.use('/api/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/api/disposal-requests', authMiddleware, disposalRequestsRoutes);
app.use('/api/settings', authMiddleware, settingsRoutes);
app.use('/api/approvals', authMiddleware, require('./routes/approvals'));
app.use('/api/all-approvals', authMiddleware, require('./routes/allApprovals'));
app.use('/api/stock-adjustments', authMiddleware, stockAdjustmentsRoutes);
app.use('/api/dashboard', authMiddleware, dashboardRoutes);

// Warehouses (Enhancement #24)
try {
    app.use('/api/warehouses', authMiddleware, require('./routes/warehouses'));
} catch (e) {}

// Swagger (Enhancement #20) - if available
try {
    const swaggerJsdoc = require('swagger-jsdoc');
    const swaggerUi = require('swagger-ui-express');
    const swaggerSpec = swaggerJsdoc({
        definition: {
            openapi: '3.0.0',
            info: { title: 'SWMS API', version: '1.0.0' }
        },
        apis: ['./routes/*.js']
    });
    app.use('/api-docs-swagger', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
} catch (e) { /* Swagger optional */ }

// Auth prototype pages: extensionless / trailing-slash URLs (regex + static only match exact /name.html)
app.get('/forgot-password', (req, res) => res.redirect(302, '/forgot-password.html'));
// String path '/forgot-password.html/' wrongly matched '/forgot-password.html' and caused a redirect loop.
app.get(/^\/forgot-password\.html\/$/, (req, res) => res.redirect(302, '/forgot-password.html'));

// Serve any file from prototypes - /prototypes/xxx or /xxx
app.get(/^\/prototypes\/(.+)$/, (req, res) => {
  const file = req.params[0] || 'login.html';
  res.sendFile(path.join(prototypesPath, file), (err) => { if (err) res.status(404).send('Not found'); });
});
app.get(/^\/(login|dashboard|staff-dashboard|suppliers|inventory|alerts|bookings|reports|users|notifications|purchasing|compare|forgot-password|set-password|my-account|audit|settings|receiving|issuing|warehouses)\.html$/, (req, res) => {
  res.sendFile(path.join(prototypesPath, req.params[0] + '.html'), (err) => { if (err) res.status(404).send('Not found'); });
});

// Serve prototypes at /prototypes/* and at root
app.use('/prototypes', express.static(prototypesPath));
app.use(express.static(prototypesPath));
app.use(express.static(publicPath));

// 404 handler (route not found)
app.use((req, res) => {
    res.status(404).json({ 
        error: 'Route not found',
        path: req.path 
    });
});

// Error handler (catches all errors)
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({ 
        error: 'Internal server error',
        message: err.message 
    });
});

// ============================================
// START SERVER
// ============================================

async function startServer() {
    // Enforce JWT_SECRET in production
    const secret = process.env.JWT_SECRET;
    if (!secret || secret === 'secret_key') {
        console.warn('\n⚠️  JWT_SECRET not set or using default. Set JWT_SECRET in .env for production!\n');
    }
    
    // Test database connection (don't block server start)
    try {
        await db.testConnection();
        const { ensurePurchasingTables } = require('./ensurePurchasingTables');
        await ensurePurchasingTables();
        const { ensureWarehousesTable } = require('./ensureWarehousesTable');
        await ensureWarehousesTable();
        const { ensureUserInvitationColumns } = require('./utils/ensureUserInvitationColumns');
        await ensureUserInvitationColumns();
        const { ensureInventoryItemsForProducts } = require('./ensureInventoryItems');
        await ensureInventoryItemsForProducts();
    } catch (err) {
        console.log('\n⚠️  Database connection failed. Server will start anyway.');
        console.log('   Fix MySQL (XAMPP) and .env, then restart. DB operations will fail until then.\n');
    }
    
    // Bind HTTP server: attach 'error' BEFORE listen() so EADDRINUSE is never unhandled.
    const server = http.createServer(app);
    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`\n❌ Port ${PORT} is already in use (another process is listening).`);
            console.error('   Fix: stop the other server, or use a different port: PORT=3001 npm start');
            console.error(`   Find PID: lsof -i :${PORT} -sTCP:LISTEN   then: kill <PID>\n`);
            process.exit(1);
        }
        console.error('Server listen error:', err);
        process.exit(1);
    });
    server.listen(PORT, () => {
        console.log('\n' + '='.repeat(50));
        console.log(`🚀 SWMS Backend Server Running!`);
        console.log(`📍 Server: http://localhost:${PORT}`);
        console.log(`🔐 Login: http://localhost:${PORT}/login.html`);
        console.log(`📊 API Docs: http://localhost:${PORT}/`);
        console.log(`📧 Test SMTP: http://localhost:${PORT}/api/test-smtp?to=your@email.com`);
        console.log('='.repeat(50) + '\n');
        startDailyAlertsJob();
        startMinuteAlertsJob();
    });
}

// Start the server
startServer();

