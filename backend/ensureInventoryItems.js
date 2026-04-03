/**
 * Ensures every product has an inventory_items row.
 * Fixes "orphaned" products (exist in products but not inventory_items) so they appear in the inventory list.
 */
const db = require('./config/database');

async function ensureInventoryItemsForProducts() {
    try {
        const [orphans] = await db.execute(`
            SELECT p.productId
            FROM products p
            LEFT JOIN inventory_items i ON i.productId = p.productId
            WHERE i.inventoryId IS NULL
        `);
        if (orphans.length === 0) return;
        for (const row of orphans) {
            try {
                await db.execute(
                    `INSERT INTO inventory_items (productId, totalQty, available, reserved, location) VALUES (?, 0, 0, 0, NULL)`,
                    [row.productId]
                );
            } catch (e) {
                if (e.code === 'ER_BAD_FIELD_ERROR' || e.code === 'ER_NO_DEFAULT_FOR_FIELD') {
                    try {
                        await db.execute(
                            `INSERT INTO inventory_items (productId, totalQty, available, reserved) VALUES (?, 0, 0, 0)`,
                            [row.productId]
                        );
                    } catch (e2) {
                        console.warn('[ensureInventoryItems] Skip product', row.productId, e2.message);
                    }
                } else {
                    console.warn('[ensureInventoryItems] Skip product', row.productId, e.message);
                }
            }
        }
        if (orphans.length > 0) {
            console.log(`[ensureInventoryItems] Created ${orphans.length} missing inventory_items row(s) for orphaned products.`);
        }
    } catch (err) {
        console.warn('[ensureInventoryItems] Could not repair orphaned products:', err.message);
    }
}

module.exports = { ensureInventoryItemsForProducts };
