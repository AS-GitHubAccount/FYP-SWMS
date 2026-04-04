/**
 * Alert Checker - Conditional logic (Power Automate style)
 *
 * After inventory changes (receiving/issuing), checks:
 * - availableQty < minStock -> LOW_STOCK
 * - expiryDate <= today -> EXPIRED
 * - expiryDate <= today + 7 days -> NEAR_EXPIRY
 *
 * Creates alerts only when needed; avoids duplicates for same product/batch.
 */

const db = require('../config/database');
const { notifyAdmins } = require('./notificationHelper');

/** Get nearExpiryDays from system_settings (default 7) */
async function getNearExpiryDays(conn = null) {
    const c = conn || db;
    try {
        const [rows] = await c.execute(
            "SELECT settingValue FROM system_settings WHERE settingKey = 'nearExpiryDays'"
        );
        const val = rows[0]?.settingValue;
        const n = parseInt(val, 10);
        return isNaN(n) || n < 1 ? 7 : Math.min(n, 365);
    } catch {
        return 7;
    }
}

/**
 * Check inventory and batches for a product and create alerts as needed.
 * Call after receiving or issuing to keep alerts in sync.
 *
 * @param {number} productId
 * @param {import('mysql2/promise').PoolConnection} [connection] - Optional; use for transactions
 */
async function checkAndCreateAlerts(productId, connection = null) {
    const conn = connection || db;

    try {
        const [products] = await conn.execute(
            'SELECT productId, name, sku, minStock, category, productType FROM products WHERE productId = ?',
            [productId]
        );
        if (products.length === 0) return;

        const product = products[0];
        const category = (product.category || '').toLowerCase();
        const productType = (product.productType || 'GOODS').toUpperCase();
        const isFoodOrConsumable = category.includes('food') || category.includes('consumable') || category.includes('perishable');
        const isITAsset = productType === 'EQUIPMENT' || productType === 'GOODS_WITH_SERVICE' || category.includes('it') || category.includes('asset');

        const today = new Date().toISOString().split('T')[0];
        const nearDays = await getNearExpiryDays(conn);
        const thresholdDate = new Date(Date.now() + nearDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        // --- LOW_STOCK ---
        const [inv] = await conn.execute(
            'SELECT available FROM inventory_items WHERE productId = ?',
            [productId]
        );
        const available = inv.length > 0 ? (inv[0].available || 0) : 0;
        const minStock = product.minStock || 0;

        if (minStock > 0 && available < minStock) {
            const [existing] = await conn.execute(
                `SELECT alertId FROM alerts 
                 WHERE productId = ? AND alertType = 'LOW_STOCK' AND resolved = FALSE`,
                [productId]
            );
            if (existing.length === 0) {
                const msg = `${product.name} (${product.sku}): low stock (${available} available, min ${minStock})`;
                const [res] = await conn.execute(
                    `INSERT INTO alerts (alertType, severity, productId, batchId, message)
                     VALUES ('LOW_STOCK', 'WARN', ?, NULL, ?)`,
                    [productId, msg]
                );
                await notifyAdmins(msg, {
                    triggeredBy: 1,
                    notificationType: 'WARNING',
                    relatedEntityType: 'alert',
                    relatedEntityId: res.insertId,
                });
            }
        }

        // --- BATCH EXPIRY (NEAR_EXPIRY, EXPIRED) — only for Food/Consumable; IT Assets use warranty/maintenance only ---
        const [batches] = await conn.execute(
            `SELECT batchId, lotCode, quantity, expiryDate, warrantyExpiry, nextMaintenanceDue 
             FROM batches WHERE productId = ? AND quantity > 0`,
            [productId]
        );

        for (const batch of batches) {
            const raw = batch.expiryDate;
            const exp = !raw ? null : (typeof raw === 'string' ? raw.substring(0, 10) : raw.toISOString().split('T')[0]);
            if (exp && isFoodOrConsumable && !isITAsset) {
                let alertType = null;
                let severity = 'WARN';
                let msg = null;

                if (exp < today) {
                    alertType = 'EXPIRED';
                    severity = 'CRITICAL';
                    msg = `${product.name} - Batch ${batch.lotCode}: expired on ${exp} (${batch.quantity} units)`;
                } else if (exp <= thresholdDate) {
                    alertType = 'NEAR_EXPIRY';
                    msg = `${product.name} - Batch ${batch.lotCode}: expires ${exp} (${batch.quantity} units)`;
                }

                if (alertType) {
                    const [existing] = await conn.execute(
                        `SELECT alertId FROM alerts 
                         WHERE batchId = ? AND alertType = ? AND resolved = FALSE`,
                        [batch.batchId, alertType]
                    );
                    if (existing.length === 0) {
                        const [res] = await conn.execute(
                            `INSERT INTO alerts (alertType, severity, productId, batchId, message)
                             VALUES (?, ?, ?, ?, ?)`,
                            [alertType, severity, productId, batch.batchId, msg]
                        );
                        await notifyAdmins(msg, {
                            triggeredBy: 1,
                            notificationType: severity === 'CRITICAL' ? 'WARNING' : 'INFO',
                            relatedEntityType: 'alert',
                            relatedEntityId: res.insertId,
                        });
                    }
                }
            }

            // --- WARRANTY_EXPIRING (batches with warrantyExpiry) — especially for IT Assets ---
            const warrRaw = batch.warrantyExpiry;
            const warr = !warrRaw ? null : (typeof warrRaw === 'string' ? warrRaw.substring(0, 10) : warrRaw.toISOString().split('T')[0]);
            const warrantyDays = Math.max(nearDays, 30);
            const warrantyThreshold = new Date(Date.now() + warrantyDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            if (warr && warr >= today && warr <= warrantyThreshold) {
                const [existing] = await conn.execute(
                    `SELECT alertId FROM alerts 
                     WHERE batchId = ? AND alertType = 'WARRANTY_EXPIRING' AND resolved = FALSE`,
                    [batch.batchId]
                );
                if (existing.length === 0) {
                    const msg = `${product.name} - Batch ${batch.lotCode}: warranty expires ${warr}`;
                    const [res] = await conn.execute(
                        `INSERT INTO alerts (alertType, severity, productId, batchId, message)
                         VALUES ('WARRANTY_EXPIRING', 'WARN', ?, ?, ?)`,
                        [productId, batch.batchId, msg]
                    );
                    await notifyAdmins(msg, { triggeredBy: 1, notificationType: 'INFO', relatedEntityType: 'alert', relatedEntityId: res.insertId });
                }
            }

            // --- MAINTENANCE_DUE (batches with nextMaintenanceDue) — IT Assets and equipment ---
            const maintRaw = batch.nextMaintenanceDue;
            const maint = !maintRaw ? null : (typeof maintRaw === 'string' ? maintRaw.substring(0, 10) : maintRaw.toISOString().split('T')[0]);
            if (maint && maint <= thresholdDate && maint >= today) {
                const [existing] = await conn.execute(
                    `SELECT alertId FROM alerts 
                     WHERE batchId = ? AND alertType = 'MAINTENANCE_DUE' AND resolved = FALSE`,
                    [batch.batchId]
                );
                if (existing.length === 0) {
                    const msg = `${product.name} - Batch ${batch.lotCode}: maintenance due by ${maint}`;
                    const [res] = await conn.execute(
                        `INSERT INTO alerts (alertType, severity, productId, batchId, message)
                         VALUES ('MAINTENANCE_DUE', 'WARN', ?, ?, ?)`,
                        [productId, batch.batchId, msg]
                    );
                    await notifyAdmins(msg, { triggeredBy: 1, notificationType: 'WARNING', relatedEntityType: 'alert', relatedEntityId: res.insertId });
                }
            }
        }
    } catch (err) {
        console.error('[alertChecker] checkAndCreateAlerts failed:', err.message);
    }
}

/**
 * Run alert checks for all products. Used by the daily scheduled job.
 */
async function checkAllProducts(connection = null) {
    const conn = connection || db;
    const [products] = await conn.execute('SELECT productId FROM products');
    for (const p of products) {
        await checkAndCreateAlerts(p.productId, conn);
    }
}

/** Drop alerts when stock/expiry no longer triggers them */
async function autoResolveAlerts(connection = null) {
    const conn = connection || db;
    const today = new Date().toISOString().split('T')[0];
    try {
        const [unresolved] = await conn.execute(
            `SELECT a.alertId, a.alertType, a.productId, a.batchId FROM alerts a WHERE a.resolved = FALSE`
        );
        for (const a of unresolved) {
            let shouldResolve = false;
            if (a.alertType === 'LOW_STOCK') {
                const [inv] = await conn.execute('SELECT available FROM inventory_items WHERE productId = ?', [a.productId]);
                const [prod] = await conn.execute('SELECT minStock FROM products WHERE productId = ?', [a.productId]);
                const available = inv.length ? (inv[0].available || 0) : 0;
                const minStock = prod.length ? (prod[0].minStock || 0) : 0;
                if (minStock === 0 || available >= minStock) shouldResolve = true;
            } else if (a.alertType === 'MAINTENANCE_DUE' && a.batchId) {
                const [batches] = await conn.execute('SELECT nextMaintenanceDue, quantity FROM batches WHERE batchId = ?', [a.batchId]);
                const next = batches[0]?.nextMaintenanceDue ? String(batches[0].nextMaintenanceDue).substring(0, 10) : null;
                if (!batches.length || batches[0].quantity <= 0 || !next || next > today) shouldResolve = true;
            } else if (a.alertType === 'WARRANTY_EXPIRING' && a.batchId) {
                const [batches] = await conn.execute('SELECT warrantyExpiry, quantity FROM batches WHERE batchId = ?', [a.batchId]);
                const warr = batches[0]?.warrantyExpiry ? String(batches[0].warrantyExpiry).substring(0, 10) : null;
                if (!batches.length || batches[0].quantity <= 0 || !warr || warr < today) shouldResolve = true;
            } else if (a.batchId) {
                const [batches] = await conn.execute('SELECT quantity FROM batches WHERE batchId = ?', [a.batchId]);
                if (!batches.length || batches[0].quantity <= 0) shouldResolve = true;
            }
            if (shouldResolve) {
                await conn.execute('UPDATE alerts SET resolved = TRUE, resolvedAt = NOW() WHERE alertId = ?', [a.alertId]);
            }
        }
    } catch (e) {
        console.error('[alertChecker] autoResolveAlerts:', e.message);
    }
}

module.exports = {
    checkAndCreateAlerts,
    checkAllProducts,
    autoResolveAlerts,
};
