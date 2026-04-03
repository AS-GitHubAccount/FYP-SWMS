/**
 * Database Configuration
 * 
 * This file sets up the connection to MySQL database.
 * Make sure you have:
 * 1. MySQL installed and running
 * 2. Created the database (see setup.sql)
 * 3. Updated .env file with your credentials
 */

const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');

function loadDbConfig() {
    const envPath = path.join(__dirname, '..', '.env');
    if (fs.existsSync(envPath)) {
        require('dotenv').config({ path: envPath, override: true });
    }
    let dbPassword = process.env.DB_PASSWORD;
    if ((dbPassword === undefined || dbPassword === null || dbPassword === '') && fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8').replace(/\r\n/g, '\n');
        const match = envContent.match(/^\s*DB_PASSWORD\s*=\s*(.*)$/m);
        if (match) {
            dbPassword = match[1].trim().replace(/^["']|["']$/g, '');
        }
    }
    const config = {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT, 10) || 3306,
        user: process.env.DB_USER || 'root',
        password: (dbPassword !== undefined && dbPassword !== null && dbPassword !== '') ? String(dbPassword) : '',
        database: process.env.DB_NAME || 'swms_db',
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        // Fail fast if MySQL is down or unreachable (otherwise TCP + pool queue can hang a long time).
        connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 15000)
    };
    // Azure / Aiven MySQL require TLS; Node may reject the chain unless Aiven CA is provided (recommended).
    if (process.env.DB_SSL === 'true' || process.env.DB_SSL === '1') {
        const caRel = process.env.DB_SSL_CA;
        const caPath = caRel
            ? (path.isAbsolute(caRel) ? caRel : path.join(__dirname, '..', caRel))
            : null;
        if (caPath && fs.existsSync(caPath)) {
            config.ssl = { ca: fs.readFileSync(caPath) };
        } else {
            const allowInsecure =
                process.env.DB_SSL_REJECT_UNAUTHORIZED === 'false' ||
                process.env.DB_SSL_REJECT_UNAUTHORIZED === '0';
            config.ssl = { rejectUnauthorized: !allowInsecure };
        }
    }
    return config;
}

let _pool = null;
function getPool() {
    if (!_pool) {
        const config = loadDbConfig();
        _pool = mysql.createPool(config);
    }
    return _pool;
}
function resetPool() {
    if (_pool) {
        try { _pool.end && _pool.end(); } catch (e) {}
        _pool = null;
    }
}

// Custom methods (not on mysql pool)
const customMethods = { testConnection, getConnectionErrorMessage, loadDbConfig };

// Proxy: defer pool creation until first DB call (ensures .env is read at request time)
const poolProxy = new Proxy(customMethods, {
    get(target, prop) {
        if (prop in target) return target[prop];
        return getPool()[prop];
    }
});

// User-friendly error messages for common DB issues
function getConnectionErrorMessage(error) {
    if (!error) return 'Database connection failed';
    if (error.code === 'ECONNREFUSED') {
        return 'Cannot connect to MySQL server. Please ensure MySQL is running (e.g. start XAMPP or MySQL service).';
    }
    if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') {
        return `Cannot resolve database host "${process.env.DB_HOST || 'localhost'}". Check DB_HOST in .env matches Aiven Connection information and that DNS works (dig +short).`;
    }
    if (error.code === 'ER_ACCESS_DENIED_ERROR') {
        return 'Access denied: Invalid username or password. Check DB_USER and DB_PASSWORD in .env. For root with no password, use DB_PASSWORD= (empty).';
    }
    if (error.code === 'ER_BAD_DB_ERROR') {
        return `Database "${process.env.DB_NAME || 'swms_db'}" does not exist. Create it first (run setup.sql).`;
    }
    return error.message || 'Unknown database error';
}

// Test connection
async function testConnection() {
    try {
        const connection = await getPool().getConnection();
        console.log('✅ Database connected successfully!');
        connection.release();
        return true;
    } catch (error) {
        resetPool(); // allow next request to retry with fresh config
        const friendlyMsg = getConnectionErrorMessage(error);
        console.error('❌ Database connection failed:', error.message);
        console.error('   Error code:', error.code);
        console.error('   Friendly:', friendlyMsg);
        console.log('\n💡 Checklist:');
        console.log('   1. MySQL is running (XAMPP Control Panel / MySQL Workbench)');
        console.log('   2. Database exists: CREATE DATABASE swms_db;');
        console.log('   3. .env has correct DB_USER, DB_PASSWORD (empty if no password)');
        console.log('   4. Restart backend after changing .env: npm start');
        // Attach friendly message for API responses
        error.userMessage = friendlyMsg;
        throw error;
    }
}

module.exports = poolProxy;

