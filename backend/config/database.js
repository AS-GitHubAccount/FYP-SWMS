// MySQL pool (see setup.sql, .env)
const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');
/** Escapes ?-style values for the text protocol (not the binary prepared-statement path). */
const sqlFormat = require('mysql2').format;

function loadDbConfig() {
    const envPath = path.join(__dirname, '..', '.env');
    // Do not use override: true — Railway/Render inject env first; a local .env must not wipe them.
    if (fs.existsSync(envPath)) {
        require('dotenv').config({ path: envPath, override: false });
    }
    let dbPassword = process.env.DB_PASSWORD;
    if ((dbPassword === undefined || dbPassword === null || dbPassword === '') && fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8').replace(/\r\n/g, '\n');
        const match = envContent.match(/^\s*DB_PASSWORD\s*=\s*(.*)$/m);
        if (match) {
            dbPassword = match[1].trim().replace(/^["']|["']$/g, '');
        }
    }

    const host = process.env.DB_HOST || 'localhost';
    const isAivenHost = /aivencloud\.com/i.test(host);
    let database = process.env.DB_NAME;
    if (database == null || String(database).trim() === '') {
        database = isAivenHost ? 'defaultdb' : 'swms_db';
    } else {
        database = String(database).trim();
    }

    const sslFlag = process.env.DB_SSL;
    let useSsl = sslFlag === 'true' || sslFlag === '1';
    if (sslFlag !== 'false' && sslFlag !== '0' && isAivenHost) {
        useSsl = true;
    }

    const config = {
        host,
        port: parseInt(process.env.DB_PORT, 10) || 3306,
        user: process.env.DB_USER || 'root',
        password: (dbPassword !== undefined && dbPassword !== null && dbPassword !== '') ? String(dbPassword) : '',
        database,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 15000)
    };
    if (useSsl) {
        const caRel = process.env.DB_SSL_CA;
        const caPath = caRel
            ? (path.isAbsolute(caRel) ? caRel : path.join(__dirname, '..', caRel))
            : null;
        if (caPath && fs.existsSync(caPath)) {
            config.ssl = { ca: fs.readFileSync(caPath) };
        } else {
            let allowInsecure =
                process.env.DB_SSL_REJECT_UNAUTHORIZED === 'false' ||
                process.env.DB_SSL_REJECT_UNAUTHORIZED === '0';
            const strictTls =
                process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true' ||
                process.env.DB_SSL_REJECT_UNAUTHORIZED === '1';
            // Aiven without a CA file on disk: encrypted TLS but skip chain verify (same as DEPLOY.md quick path).
            if (isAivenHost && !strictTls) {
                allowInsecure = true;
            }
            config.ssl = { rejectUnauthorized: !allowInsecure };
        }
    }
    return config;
}

let _pool = null;

/**
 * Normalize values before sqlstring.format. Undefined → NULL in SQL; NaN numbers → NULL.
 * MySQL 8.0.22+ often throws ER_WRONG_ARGUMENTS / "Incorrect arguments to mysqld_stmt_execute"
 * when using pool.execute() (binary prepared statements) with LIMIT/OFFSET ints and similar.
 * We route db.execute through format + query (escaped literals) to avoid that server/driver combo.
 */
function sanitizeExecuteParams(values) {
    if (values == null) return values;
    if (!Array.isArray(values)) return values;
    return values.map((v) => {
        if (v === undefined) return null;
        if (typeof v === 'number' && Number.isNaN(v)) return null;
        return v;
    });
}

function attachExecuteRouting(pool) {
    if (pool.__swmsExecuteSanitizerAttached) return pool;
    const poolQuery = pool.query.bind(pool);
    pool.execute = function executeViaEscapedQuery(sql, values) {
        if (values === undefined || values === null) {
            return poolQuery(sql);
        }
        const vals = Array.isArray(values) ? sanitizeExecuteParams(values) : values;
        return poolQuery(sqlFormat(sql, vals));
    };
    const origGetConnection = pool.getConnection.bind(pool);
    pool.getConnection = async function getConnectionSanitized() {
        const conn = await origGetConnection();
        if (!conn.__swmsExecuteWrapped) {
            const connQuery = conn.query.bind(conn);
            conn.execute = function connExecute(sql, values) {
                if (values === undefined || values === null) {
                    return connQuery(sql);
                }
                const vals = Array.isArray(values) ? sanitizeExecuteParams(values) : values;
                return connQuery(sqlFormat(sql, vals));
            };
            conn.__swmsExecuteWrapped = true;
        }
        return conn;
    };
    pool.__swmsExecuteSanitizerAttached = true;
    return pool;
}

function getPool() {
    if (!_pool) {
        const config = loadDbConfig();
        _pool = attachExecuteRouting(mysql.createPool(config));
    }
    return _pool;
}
function resetPool() {
    if (_pool) {
        try { _pool.end && _pool.end(); } catch (e) {}
        _pool = null;
    }
}

function getResolvedDatabaseName() {
    return loadDbConfig().database;
}

const customMethods = { testConnection, getConnectionErrorMessage, loadDbConfig, getResolvedDatabaseName };

const poolProxy = new Proxy(customMethods, {
    get(target, prop) {
        if (prop in target) return target[prop];
        return getPool()[prop];
    }
});

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
        const name = getResolvedDatabaseName();
        return `Database "${name}" does not exist or is not accessible. Create it and run setup.sql (Aiven usually uses defaultdb).`;
    }
    return error.message || 'Unknown database error';
}

async function testConnection() {
    try {
        const connection = await getPool().getConnection();
        console.log('Database OK');
        connection.release();
        return true;
    } catch (error) {
        resetPool();
        const friendlyMsg = getConnectionErrorMessage(error);
        console.error('Database:', error.message, error.code || '');
        console.error(friendlyMsg);
        error.userMessage = friendlyMsg;
        throw error;
    }
}

module.exports = poolProxy;
