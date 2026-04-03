/**
 * Seed a few inventory items with specific stock levels
 * so the Inventory "All Items" page can show:
 * - OK stock
 * - Low stock
 * - Out of stock
 *
 * Usage (from backend folder):
 *   node scripts/seedInventoryLevelsTestData.js
 *
 * This script is idempotent and adjusts only a small
 * set of clearly named test products.
 */

const db = require('../config/database');

async function upsertProduct({ sku, name, category, minStock }) {
  const [rows] = await db.execute(
    `
      INSERT INTO products (sku, name, category, unit, minStock, productType)
      VALUES (?, ?, ?, 'unit', ?, 'GOODS')
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        category = VALUES(category),
        unit = VALUES(unit),
        minStock = VALUES(minStock),
        productType = VALUES(productType),
        productId = LAST_INSERT_ID(productId)
    `,
    [sku, name, category, minStock]
  );
  return rows.insertId;
}

async function setInventory({ productId, totalQty, available, reserved, location }) {
  await db.execute(
    `
      INSERT INTO inventory_items (productId, totalQty, available, reserved, location)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        totalQty = VALUES(totalQty),
        available = VALUES(available),
        reserved = VALUES(reserved),
        location = VALUES(location)
    `,
    [productId, totalQty, available, reserved, location]
  );
}

async function main() {
  try {
    // 1) OK stock item (above minStock)
    const okProductId = await upsertProduct({
      sku: 'INV-OK-001',
      name: 'Inventory OK Test Item',
      category: 'Inventory Test',
      minStock: 20
    });
    await setInventory({
      productId: okProductId,
      totalQty: 100,
      available: 80,
      reserved: 0,
      location: 'Main Warehouse - A1'
    });

    // 2) Low stock item (available <= minStock but > 0)
    const lowProductId = await upsertProduct({
      sku: 'INV-LOW-001',
      name: 'Inventory LOW Test Item',
      category: 'Inventory Test',
      minStock: 30
    });
    await setInventory({
      productId: lowProductId,
      totalQty: 30,
      available: 25,
      reserved: 0,
      location: 'Main Warehouse - A2'
    });

    // 3) Out of stock item (totalQty = 0)
    const outProductId = await upsertProduct({
      sku: 'INV-OUT-001',
      name: 'Inventory OUT Test Item',
      category: 'Inventory Test',
      minStock: 10
    });
    await setInventory({
      productId: outProductId,
      totalQty: 0,
      available: 0,
      reserved: 0,
      location: 'Main Warehouse - A3'
    });

    console.log('✅ Seeded inventory levels test data (OK, LOW, OUT).');
  } catch (err) {
    console.error('❌ Failed to seed inventory levels test data:', err);
  } finally {
    try {
      if (db && typeof db.end === 'function') {
        await db.end();
      }
    } catch (e) {}
    process.exit(0);
  }
}

main();

