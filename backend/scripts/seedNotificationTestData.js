/**
 * Seed minimal inventory + notification test data.
 *
 * Usage (from backend folder):
 *   node scripts/seedNotificationTestData.js
 *
 * This script:
 * - Ensures a small set of products + inventory_items exist
 * - Creates a few batches for those products
 * - Inserts one notification per major category (purchasing, booking, issuing, receiving, alert, other)
 *
 * It is idempotent and will not create a huge amount of data.
 */

const db = require('../config/database');

async function upsertProduct({ sku, name, category }) {
  const [rows] = await db.execute(
    `
      INSERT INTO products (sku, name, category, unit, minStock, productType)
      VALUES (?, ?, ?, 'unit', 10, 'GOODS')
      ON DUPLICATE KEY UPDATE
        sku = VALUES(sku),
        name = VALUES(name),
        category = VALUES(category),
        unit = VALUES(unit),
        minStock = VALUES(minStock),
        productType = VALUES(productType),
        productId = LAST_INSERT_ID(productId)
    `,
    [sku, name, category]
  );
  return rows.insertId;
}

async function upsertInventoryItem(productId) {
  await db.execute(
    `
      INSERT INTO inventory_items (productId, totalQty, available, reserved, location)
      VALUES (?, 100, 100, 0, 'Main Warehouse')
      ON DUPLICATE KEY UPDATE
        totalQty = GREATEST(totalQty, 100),
        available = GREATEST(available, 50)
    `,
    [productId]
  );
}

async function upsertBatch({ productId, lotCode, quantity, expiryDate, location }) {
  await db.execute(
    `
      INSERT INTO batches (productId, lotCode, quantity, expiryDate, location)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        quantity = GREATEST(quantity, VALUES(quantity)),
        expiryDate = VALUES(expiryDate),
        location = VALUES(location)
    `,
    [productId, lotCode, quantity, expiryDate, location]
  );
}

async function createNotificationIfMissing({ userId, notifType, message }) {
  const [existing] = await db.execute(
    `SELECT notificationId FROM notifications WHERE userId = ? AND type = ? AND message = ? LIMIT 1`,
    [userId, notifType, message]
  );
  if (existing && existing.length) return;

  const recipient = 'Admin';
  try {
    await db.execute(
      `INSERT INTO notifications (userId, type, notificationType, message, recipient, isRead, createdAt)
       VALUES (?, ?, 'INFO', ?, ?, FALSE, NOW())`,
      [userId, notifType, message, recipient]
    );
  } catch (e) {
    await db.execute(
      `INSERT INTO notifications (userId, message, recipient, isRead, createdAt) VALUES (?, ?, ?, FALSE, NOW())`,
      [userId, message, recipient]
    );
  }
}

async function main() {
  try {
    const userId = 1; // Admin test user

    // Create a few products for each category
    const purchasingProductId = await upsertProduct({
      sku: 'PO-TEST-001',
      name: 'Purchasing Test Item',
      category: 'Purchasing Test',
    });
    const bookingProductId = await upsertProduct({
      sku: 'BK-TEST-001',
      name: 'Booking Test Item',
      category: 'Booking Test',
    });
    const issuingProductId = await upsertProduct({
      sku: 'IS-TEST-001',
      name: 'Issuing Test Item',
      category: 'Issuing Test',
    });
    const receivingProductId = await upsertProduct({
      sku: 'RC-TEST-001',
      name: 'Receiving Test Item',
      category: 'Receiving Test',
    });
    const alertProductId = await upsertProduct({
      sku: 'AL-TEST-001',
      name: 'Alert Test Item',
      category: 'Alert Test',
    });

    // Ensure inventory + batches exist
    await upsertInventoryItem(purchasingProductId);
    await upsertInventoryItem(bookingProductId);
    await upsertInventoryItem(issuingProductId);
    await upsertInventoryItem(receivingProductId);
    await upsertInventoryItem(alertProductId);

    await upsertBatch({
      productId: issuingProductId,
      lotCode: 'ISS-LOT-TEST-01',
      quantity: 50,
      expiryDate: '2028-12-31',
      location: 'Main Warehouse - Shelf A1',
    });
    await upsertBatch({
      productId: receivingProductId,
      lotCode: 'RCV-LOT-TEST-01',
      quantity: 80,
      expiryDate: '2028-06-30',
      location: 'Main Warehouse - Shelf B2',
    });
    await upsertBatch({
      productId: alertProductId,
      lotCode: 'AL-LOT-NEAR-EXP',
      quantity: 20,
      expiryDate: '2026-03-25',
      location: 'Main Warehouse - Shelf C3',
    });

    // Seed one notification per major type (purchasing, booking, issuing, receiving, alert, other)
    await createNotificationIfMissing({
      userId,
      notifType: 'Request',
      message: '[Mini-seed] Purchase order PO-TEST-001 awaiting processing — Purchasing page.',
    });

    await createNotificationIfMissing({
      userId,
      notifType: 'Request',
      message: '[Mini-seed] New booking for Booking Test Item — Bookings page.',
    });

    await createNotificationIfMissing({
      userId,
      notifType: 'Request',
      message: '[Mini-seed] Issued record for Issuing Test Item — Issued Records.',
    });

    await createNotificationIfMissing({
      userId,
      notifType: 'Request',
      message: '[Mini-seed] Received stock for Receiving Test Item — Received Records.',
    });

    await createNotificationIfMissing({
      userId,
      notifType: 'Alert',
      message: '[Mini-seed] Near expiry: Alert Test Item — Alerts page.',
    });

    await createNotificationIfMissing({
      userId,
      notifType: 'Request',
      message: '[Mini-seed] Warehouse configuration updated — Settings.',
    });

    console.log('✅ Test products, batches, and notifications have been seeded.');
  } catch (err) {
    console.error('❌ Failed to seed test data:', err);
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

