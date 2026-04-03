#!/usr/bin/env node
/**
 * Quick database connection test
 * Run: node scripts/test-db-connection.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

console.log('\n--- Database Connection Test ---');
console.log('DB_HOST:', process.env.DB_HOST || 'localhost');
console.log('DB_USER:', process.env.DB_USER || 'root');
console.log('DB_PASSWORD:', process.env.DB_PASSWORD ? '(set)' : '(empty/not set)');
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
    console.log('✅ Connected successfully!');
    const [rows] = await conn.execute('SELECT 1 as test');
    console.log('✅ Query test OK');
    const dbName = process.env.DB_NAME || 'swms_db';
    const [tables] = await conn.execute(
      'SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?',
      [dbName]
    );
    console.log(`✅ Tables in "${dbName}":`, tables[0].n);
    await conn.end();
    process.exit(0);
  } catch (err) {
    console.error('❌ Connection failed:', err.message);
    if (err.code === 'ECONNREFUSED') {
      console.log('\n💡 MySQL is not running. Start it first:');
      console.log('   - XAMPP: Start MySQL from Control Panel');
      console.log('   - Homebrew: brew services start mysql');
      console.log('   - MAMP: Start MySQL from MAMP');
    }
    if (err.code === 'ER_ACCESS_DENIED_ERROR') {
      console.log('\n💡 Wrong username or password. Check .env:');
      console.log('   - If MySQL root has NO password: DB_PASSWORD=  (empty)');
      console.log('   - If MySQL root has password: DB_PASSWORD=your_actual_password');
    }
    if (err.code === 'ER_BAD_DB_ERROR') {
      console.log('\n💡 Database does not exist. Create it (local) or set DB_NAME in .env (Aiven: defaultdb).');
    }
    if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') {
      console.log('\n💡 Cannot resolve DB_HOST. Verify Host in Aiven and: dig +short $DB_HOST');
    }
    process.exit(1);
  }
}

test();
