#!/usr/bin/env node
/**
 * Import a phpMyAdmin / mysqldump SQL file into the database configured in backend/.env
 * (e.g. Aiven defaultdb). Strips CREATE DATABASE swms_db and rewrites USE swms_db -> USE <DB_NAME>.
 *
 * Usage (from backend/):
 *   node scripts/import-sql-dump.js ../exports/swms_db.sql
 *   node scripts/import-sql-dump.js --fresh ../exports/swms_db.sql   # drop all tables/views in DB_NAME first
 *
 * Or: DB_IMPORT_FRESH=1 npm run db:import -- ../exports/swms_db.sql
 *
 * Export from phpMyAdmin first: select swms_db → Export → SQL → Go.
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const argv = process.argv.slice(2);
const fresh =
    argv.includes('--fresh') ||
    process.env.DB_IMPORT_FRESH === '1' ||
    process.env.DB_IMPORT_FRESH === 'true';
const dumpPath = argv.find((a) => !a.startsWith('--'));
if (!dumpPath) {
    console.error('Usage: node scripts/import-sql-dump.js [--fresh] <path-to-dump.sql>');
    process.exit(1);
}

const abs = path.isAbsolute(dumpPath) ? dumpPath : path.resolve(process.cwd(), dumpPath);
if (!fs.existsSync(abs)) {
    console.error('File not found:', abs);
    process.exit(1);
}

const db = require('../config/database');
const base = db.loadDbConfig();
const targetDb = process.env.DB_NAME || 'defaultdb';

function preprocessDump(sql, dbName) {
    let s = sql.replace(/\r\n/g, '\n');
    s = s.replace(/USE\s+[`"]?swms_db[`"]?\s*;/gi, `USE \`${dbName}\`;`);
    s = s.replace(/CREATE\s+DATABASE(\s+IF\s+NOT\s+EXISTS)?\s+[`"]?swms_db[`"]?\s*;/gi, '');
    // MySQL 8.0.13+ requires parentheses for expression defaults; MariaDB/phpMyAdmin often export DEFAULT curdate()
    s = s.replace(/\bDEFAULT\s+curdate\s*\(\s*\)/gi, 'DEFAULT (CURDATE())');
    s = s.replace(/\bDEFAULT\s+current_date\s*\(\s*\)/gi, 'DEFAULT (CURRENT_DATE())');
    s = s.replace(/\bDEFAULT\s+current_timestamp\s*\(\s*\)/gi, 'DEFAULT (CURRENT_TIMESTAMP())');
    s = s.replace(/\bDEFAULT\s+now\s*\(\s*\)/gi, 'DEFAULT (NOW())');
    return s;
}

function escapeSqlIdent(id) {
    return String(id).replace(/`/g, '``');
}

/** Drop every table and view in schema (for re-import). Requires FOREIGN_KEY_CHECKS off for tables. */
async function dropAllUserTablesAndViews(conn, schemaName) {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    const [rows] = await conn.query(
        `SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?`,
        [schemaName]
    );
    const views = rows.filter((r) => r.TABLE_TYPE === 'VIEW');
    const tables = rows.filter((r) => r.TABLE_TYPE === 'BASE TABLE');
    for (const v of views) {
        await conn.query(`DROP VIEW IF EXISTS \`${escapeSqlIdent(v.TABLE_NAME)}\``);
    }
    for (const t of tables) {
        await conn.query(`DROP TABLE IF EXISTS \`${escapeSqlIdent(t.TABLE_NAME)}\``);
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log(`Dropped ${views.length} view(s) and ${tables.length} table(s) in "${schemaName}".`);
}

async function main() {
    const sqlRaw = fs.readFileSync(abs, 'utf8');
    const sql = preprocessDump(sqlRaw, targetDb);

    const { waitForConnections, connectionLimit, queueLimit, ...rest } = base;
    const config = {
        ...rest,
        database: targetDb,
        multipleStatements: true,
        connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 120000)
    };

    console.log('Target:', config.host, 'port', config.port, 'database', targetDb);
    if (fresh) {
        console.log('Mode: --fresh (existing tables/views in this database will be dropped first)');
    }
    console.log('Importing file:', abs, `(${Math.round(sql.length / 1024)} KB)`);

    const conn = await mysql.createConnection(config);
    try {
        if (fresh) {
            await dropAllUserTablesAndViews(conn, targetDb);
        }
        // Aiven (and some managed MySQL) enable sql_require_primary_key; legacy dumps may create tables without PK.
        await conn.query('SET SESSION sql_require_primary_key = 0');
        await conn.query(sql);
        console.log('✅ Import completed successfully.');
        const [tables] = await conn.query(
            'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME',
            [targetDb]
        );
        console.log(`Tables in ${targetDb}:`, tables.length);
    } finally {
        await conn.end();
    }
}

main().catch((err) => {
    console.error('❌ Import failed:', err.message);
    if (err.code === 'ENOTFOUND') {
        console.error('   DNS cannot resolve DB_HOST. Fix network / copy correct Host from Aiven.');
    }
    if (err.code === 'ER_ACCESS_DENIED_ERROR') {
        console.error('   Check DB_USER and DB_PASSWORD in backend/.env');
    }
    if (err.code === 'ECONNREFUSED') {
        console.error('   Cannot reach MySQL. For Aiven, use DB_SSL=true and correct host/port.');
    }
    if (err.code === 'ER_TABLE_EXISTS_ERROR' || (err.message && err.message.includes('already exists'))) {
        console.error('\n   Re-run with a clean database: npm run db:import -- --fresh /path/to/dump.sql');
    }
    console.error('\nIf this dump contains DELIMITER / stored procedures, import with the mysql CLI instead:');
    console.error('  mysql -h HOST -P PORT -u USER -p --ssl-mode=REQUIRED defaultdb < prepared.sql');
    process.exit(1);
});
