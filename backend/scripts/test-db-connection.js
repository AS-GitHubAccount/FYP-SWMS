#!/usr/bin/env node
// node scripts/test-db-connection.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

console.log('\n--- DB connection ---');
console.log('DB_HOST:', process.env.DB_HOST || 'localhost');
console.log('DB_USER:', process.env.DB_USER || 'root');
console.log('DB_PASSWORD:', process.env.DB_PASSWORD ? '(set)' : '(empty)');
console.log('DB_NAME:', process.env.DB_NAME || 'swms_db');
console.log('DB_SSL:', process.env.DB_SSL || '(off)');
console.log('');

const mysql = require('mysql2/promise');
const db = require('../config/database');

async function test() {
  try {
    const base = db.loadDbConfig();
    const { waitForConnections, connectionLimit, queueLimit, ...connOpts } = base;
    const conn = await mysql.createConnection(connOpts);
    console.log('OK: connected');
    await conn.execute('SELECT 1 as test');
    console.log('OK: query');
    const dbName = process.env.DB_NAME || 'swms_db';
    const [tables] = await conn.execute(
      'SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?',
      [dbName]
    );
    console.log(`Tables in "${dbName}":`, tables[0].n);
    await conn.end();
    process.exit(0);
  } catch (err) {
    console.error('Failed:', err.message);
    if (err.code === 'ECONNREFUSED') {
      console.log('Start MySQL (XAMPP / brew services / MAMP).');
    }
    if (err.code === 'ER_ACCESS_DENIED_ERROR') {
      console.log('Check DB_USER / DB_PASSWORD in .env');
    }
    if (err.code === 'ER_BAD_DB_ERROR') {
      console.log('Create DB or set DB_NAME (Aiven often uses defaultdb).');
    }
    if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') {
      console.log('Check DB_HOST (dig +short <host>).');
    }
    process.exit(1);
  }
}

test();
