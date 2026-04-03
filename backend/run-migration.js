/**
 * Run maintenance migration - skips duplicate column errors (safe to re-run).
 * Usage: node run-migration.js
 */
require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const statements = `
ALTER TABLE products ADD COLUMN productType ENUM('GOODS', 'EQUIPMENT', 'SERVICE', 'GOODS_WITH_SERVICE') DEFAULT 'GOODS' AFTER category;
ALTER TABLE products ADD COLUMN warrantyMonths INT NULL AFTER minStock;
ALTER TABLE products ADD COLUMN maintenanceIntervalMonths INT NULL AFTER warrantyMonths;
ALTER TABLE batches ADD COLUMN installationDate DATE NULL AFTER receivedDate;
ALTER TABLE batches ADD COLUMN warrantyExpiry DATE NULL AFTER installationDate;
ALTER TABLE batches ADD COLUMN nextMaintenanceDue DATE NULL AFTER warrantyExpiry;
ALTER TABLE batches ADD COLUMN lastMaintenanceDate DATE NULL AFTER nextMaintenanceDue;
ALTER TABLE alerts MODIFY COLUMN alertType ENUM('LOW_STOCK', 'NEAR_EXPIRY', 'EXPIRED', 'MAINTENANCE_DUE', 'WARRANTY_EXPIRING') NOT NULL;
ALTER TABLE alerts ADD COLUMN resolution_notes TEXT NULL AFTER resolvedAt;
ALTER TABLE quotations ADD COLUMN resolution_notes TEXT NULL AFTER notes;
`.trim().split(';').map(s => s.trim()).filter(Boolean);

async function run() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME || 'swms_db'
  });

  for (const stmt of statements) {
    try {
      await conn.execute(stmt);
      console.log('OK:', stmt.substring(0, 55) + '...');
    } catch (e) {
      if (e.code === 'ER_DUP_FIELDNAME') console.log('Skip (already exists):', stmt.substring(0, 45) + '...');
      else throw e;
    }
  }

  try {
    const [rows] = await conn.execute('SELECT 1 FROM products WHERE sku = ? LIMIT 1', ['PRD-EQP-001']);
    if (rows.length === 0) {
      await conn.execute(`
        INSERT INTO products (sku, name, category, unit, minStock, productType, warrantyMonths, maintenanceIntervalMonths)
        VALUES ('PRD-EQP-001', 'Industrial Forklift - Model X', 'Equipment', 'unit', 0, 'EQUIPMENT', 12, 6)
      `);
      console.log('Sample product: added');
    } else {
      console.log('Sample product: already exists');
    }
  } catch (e) {
    if (e.code === 'ER_BAD_FIELD_ERROR') console.log('Sample product: skipped (products table may need migration first)');
    else throw e;
  }

  console.log('Migration complete.');
  await conn.end();
}

run().catch(err => { console.error(err); process.exit(1); });
