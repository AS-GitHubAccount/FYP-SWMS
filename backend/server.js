// SWMS Express API
const http = require('http');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const db = require('./config/database');
const {
    createSmtpTransport,
    sendEmailWithResult,
    hasResend,
    buildSmtpTransportOptions,
    isOutboundEmailConfigured,
    isResendRestrictedTestSender,
    getResendFromEnvRaw,
    hasExplicitResendFromEnv
} = require('./utils/emailService');

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Number(process.env.RATE_LIMIT_MAX || 600),
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many requests, try again later' },
    skip: (req) => {
        if (req.method === 'GET' && req.path.startsWith('/api/')) return true;
        if (req.path === '/api/health' || req.path === '/health' || req.path === '/live') return true;
        return false;
    }
});

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
const { getFrontendBaseUrl } = require('./utils/userInviteTokens');

const app = express();
const PORT = process.env.PORT || 3000;

// Behind Railway / nginx / load balancers, X-Forwarded-For is set. Required so express-rate-limit
// can identify clients (ERR_ERL_UNEXPECTED_X_FORWARDED_FOR if false). Set TRUST_PROXY=0 to disable locally if needed.
if (process.env.TRUST_PROXY !== 'false' && process.env.TRUST_PROXY !== '0') {
    const n = process.env.TRUST_PROXY != null && String(process.env.TRUST_PROXY).trim() !== ''
        ? parseInt(process.env.TRUST_PROXY, 10)
        : 1;
    app.set('trust proxy', Number.isFinite(n) && n >= 0 ? n : 1);
}

app.use(cors({
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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/api/', limiter);

const prototypesPath = path.resolve(__dirname, '..', 'prototypes');
const publicPath = path.join(__dirname, 'public');

app.get('/', (req, res) => {
    const acceptHeader = req.get('Accept') || '';
    const isBrowser = acceptHeader.includes('text/html') || 
                      acceptHeader.includes('*/*') ||
                      (!acceptHeader.includes('application/json') && !req.query.json);
    
    if (isBrowser && !req.query.json) {
        const htmlPath = path.resolve(__dirname, 'public', 'api-docs.html');
        res.sendFile(htmlPath, (err) => {
            if (err) {
                console.error('Error sending api-docs.html:', err);
                res.json({ 
                    message: 'SWMS API running',
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
                        wizard: '/api/wizard'
                    }
                });
            }
        });
    } else {
        res.json({ 
            message: 'SWMS API running',
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
                wizard: '/api/wizard'
            }
        });
    }
});

app.get('/api-docs', (req, res) => {
    const htmlPath = path.resolve(__dirname, 'public', 'api-docs.html');
    res.sendFile(htmlPath, (err) => {
        if (err) {
            console.error('Error sending api-docs.html:', err);
            res.status(500).json({ error: 'Failed to load documentation', message: err.message });
        }
    });
});

app.get('/api-docs.html', (req, res) => {
    const htmlPath = path.resolve(__dirname, 'public', 'api-docs.html');
    res.sendFile(htmlPath, (err) => {
        if (err) {
            console.error('Error sending api-docs.html:', err);
            res.status(500).json({ error: 'Failed to load documentation', message: err.message });
        }
    });
});

app.get('/live', (req, res) => {
    const email = hasResend() ? 'resend' : buildSmtpTransportOptions() ? 'smtp' : 'none';
    res.status(200).json({
        status: 'alive',
        timestamp: new Date().toISOString(),
        email,
        build: 'swms-email-v2'
    });
});

app.get('/health', async (req, res) => {
    try {
        const cfg = db.loadDbConfig();
        const dbConnected = await db.testConnection();
        res.json({
            status: 'ok',
            database: dbConnected ? 'connected' : 'disconnected',
            dbHost: cfg.host,
            dbName: cfg.database,
            dbSsl: !!cfg.ssl,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        const cfg = db.loadDbConfig();
        const friendly =
            error.userMessage ||
            (typeof db.getConnectionErrorMessage === 'function' ? db.getConnectionErrorMessage(error) : '') ||
            error.message ||
            error.sqlMessage ||
            'Unknown database error';
        res.status(500).json({
            status: 'error',
            database: 'error',
            error: friendly,
            errorCode: error.code || null,
            dbHost: cfg.host,
            dbName: cfg.database,
            dbSsl: !!cfg.ssl,
            timestamp: new Date().toISOString()
        });
    }
});

const handleTestEmail = async (req, res) => {
    const to = req.body?.to || req.query?.to;
    if (!to) return res.status(400).json({ success: false, error: 'Provide ?to=your@email.com' });
    console.log('[test-email] transport:', hasResend() ? 'resend' : createSmtpTransport() ? 'smtp' : 'none');
    if (hasResend()) {
        const r = await sendEmailWithResult({
            to,
            subject: 'SWMS - Test Email',
            text: 'If you receive this, email (Resend) is working.',
            html: '<p>If you receive this, email (Resend) is working.</p>'
        });
        if (!r.ok) return res.status(500).json({ success: false, error: r.userMessage || 'Resend send failed' });
        return res.json({ success: true, message: 'Test email sent via Resend.', diagnostics: { via: 'resend' } });
    }
    const t = createSmtpTransport();
    if (!t) {
        return res.json({
            success: false,
            error: 'Email not configured. Set RESEND_API_KEY or SMTP_USER + SMTP_PASS in .env'
        });
    }
    const fromUser = process.env.SMTP_USER;
    try {
        await t.verify();
        const info = await t.sendMail({ from: `"SWMS Test" <${fromUser}>`, to, subject: 'SWMS - Test Email', text: 'If you receive this, SMTP is working.' });
        return res.json({
            success: true,
            message: 'Test email sent. Check inbox and spam.',
            diagnostics: { messageId: info.messageId, accepted: info.accepted, via: 'smtp' }
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
};
app.all('/api/auth/test-email', handleTestEmail);
app.all('/api/test-smtp', handleTestEmail);

app.get('/api', (req, res) => {
    res.json({
        message: 'SWMS API',
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

app.use('/api/auth', authRoutes);
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
app.use('/api/batches', authMiddleware, batchesRoutes);
app.use('/api/products', authMiddleware, productsRoutes);
app.use('/api/inventory', authMiddleware, inventoryRoutes);
app.use('/api/users', authMiddleware, usersRoutes);
app.use('/api/receiving', authMiddleware, receivingRoutes);
app.use('/api/issuing', authMiddleware, issuingRoutes);
app.use('/api/alerts', optionalAuth, alertsRoutes);
app.use('/api/bookings', authMiddleware, bookingsRoutes);
app.use('/api/notifications', optionalAuth, notificationsRoutes);
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

try {
    app.use('/api/warehouses', authMiddleware, require('./routes/warehouses'));
} catch (e) {}

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
} catch (e) {}

app.get('/forgot-password', (req, res) => res.redirect(302, '/forgot-password.html'));
app.get(/^\/forgot-password\.html\/$/, (req, res) => res.redirect(302, '/forgot-password.html'));

app.get(/^\/prototypes\/(.+)$/, (req, res) => {
  const file = req.params[0] || 'login.html';
  res.sendFile(path.join(prototypesPath, file), (err) => { if (err) res.status(404).send('Not found'); });
});
app.get(/^\/(login|dashboard|staff-dashboard|suppliers|inventory|alerts|bookings|reports|users|notifications|purchasing|compare|forgot-password|set-password|my-account|settings|receiving|issuing|warehouses)\.html$/, (req, res) => {
  res.sendFile(path.join(prototypesPath, req.params[0] + '.html'), (err) => { if (err) res.status(404).send('Not found'); });
});

app.use('/prototypes', express.static(prototypesPath));
app.use(express.static(prototypesPath));
app.use(express.static(publicPath));

app.use((req, res) => {
    res.status(404).json({ 
        error: 'Route not found',
        path: req.path 
    });
});

app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({ 
        error: 'Internal server error',
        message: err.message 
    });
});

async function startServer() {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret === 'secret_key') {
        console.warn('JWT_SECRET missing or default; set in .env for production.');
    }

    if (!isOutboundEmailConfigured()) {
        console.warn(
            '[email] Outbound mail not configured (set RESEND_API_KEY or SMTP_USER + SMTP_PASS). Invitation / password emails will not send until configured.'
        );
    } else {
        console.log('[email] Outbound mail configured (Resend and/or SMTP).');
    }

    if (hasResend()) {
        console.log('[email] Resend From (effective):', getResendFromEnvRaw());
        if (!hasExplicitResendFromEnv()) {
            console.warn(
                '[email] RESEND_FROM / RESEND_MAIL_FROM not set — using onboarding@resend.dev (sandbox). ' +
                    'Set RESEND_FROM=noreply@your-verified-domain.com in Railway Variables and redeploy. ' +
                    'If the value has quotes in the dashboard, they are stripped; avoid leading/trailing spaces.'
            );
        }
        if (isResendRestrictedTestSender()) {
            console.warn(
                '[email] Resend sandbox sender is active (onboarding@resend.dev). Only your Resend signup email can receive mail. ' +
                    'Set RESEND_FROM to an address on your verified domain (e.g. noreply@smartwarehouse.casa) and redeploy.'
            );
        }
    }

    const publicBase = getFrontendBaseUrl();
    console.log('[invite] set-password links in emails use base URL:', publicBase);
    if (/^http:\/\/localhost/i.test(publicBase) && String(process.env.RAILWAY_ENVIRONMENT || '').trim()) {
        console.warn(
            '[invite] Still using localhost for links. Set FRONTEND_BASE_URL to your public https URL (e.g. https://your-app.up.railway.app) so invitation emails work.'
        );
    }

    try {
        await db.testConnection();
        const { ensurePurchasingTables } = require('./ensurePurchasingTables');
        await ensurePurchasingTables();
        const { ensureWarehousesTable } = require('./ensureWarehousesTable');
        await ensureWarehousesTable();
        const { ensureUserInvitationColumns } = require('./utils/ensureUserInvitationColumns');
        await ensureUserInvitationColumns();
        const { ensureSupplierNotesColumn } = require('./utils/ensureSupplierNotesColumn');
        await ensureSupplierNotesColumn();
        const { ensureInventoryItemsForProducts } = require('./ensureInventoryItems');
        await ensureInventoryItemsForProducts();
    } catch (err) {
        console.warn('Database unavailable at startup; server still listening. Fix .env/MySQL and restart.');
    }

    const server = http.createServer(app);
    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`Port ${PORT} in use. Stop the other process or set PORT.`);
            process.exit(1);
        }
        console.error('Server listen error:', err);
        process.exit(1);
    });
    server.listen(PORT, () => {
        console.log(`Listening on http://localhost:${PORT}  (docs /  login /api-docs  /api-docs-swagger)`);
        startDailyAlertsJob();
        startMinuteAlertsJob();
    });
}

startServer();

