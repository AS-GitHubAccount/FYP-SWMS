/**
 * Run RFQ process migration (requires purchase_requests from enhancements.sql)
 * Usage: node run-rfq-migration.js
 */
require('dotenv').config();
const fs = require('fs');
const mysql = require('mysql2/promise');
const path = require('path');

async function run() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME || 'swms_db',
    multipleStatements: true
  });

  // 1. Run enhancements.sql first (creates purchase_requests if missing)
  try {
    const enhancements = fs.readFileSync(path.join(__dirname, 'migrations', 'enhancements.sql'), 'utf8');
    await conn.query(enhancements);
    console.log('Enhancements migration OK');
  } catch (e) {
    if (e.code === 'ER_DUP_FIELDNAME' || e.code === 'ER_TABLE_EXISTS_ERROR') {
      console.log('Enhancements: tables already exist');
    } else {
      throw e;
    }
  }

  // 2. Run RFQ migration
  const rfqSql = fs.readFileSync(path.join(__dirname, 'migrations', 'rfq_process.sql'), 'utf8');
  await conn.query(rfqSql);
  console.log('RFQ migration completed.');
  await conn.end();
}

run().catch(err => { console.error(err); process.exit(1); });
