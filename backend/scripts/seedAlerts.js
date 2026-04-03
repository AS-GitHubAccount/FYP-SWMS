/**
 * Seed sample alerts into the database.
 * Usage: node scripts/seedAlerts.js
 * Or: cd backend && node scripts/seedAlerts.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../config/database');

async function seedAlerts() {
    console.log('Seeding alerts...');
    
    try {
        // Get existing products (use first 5)
        const [products] = await db.execute(
            'SELECT productId, name, sku, minStock FROM products ORDER BY productId LIMIT 5'
        );
        
        if (products.length === 0) {
            console.log('No products found. Run setup.sql first.');
            process.exit(1);
        }

        // Ensure alerts table supports all types (MAINTENANCE_DUE, WARRANTY_EXPIRING)
        try {
            await db.execute(
                "ALTER TABLE alerts MODIFY COLUMN alertType ENUM('LOW_STOCK', 'NEAR_EXPIRY', 'EXPIRED', 'MAINTENANCE_DUE', 'WARRANTY_EXPIRING') NOT NULL"
            );
            console.log('Alerts table updated for extended types.');
        } catch (e) {
            if (e.code !== 'ER_PARSE_ERROR') console.log('Alerts table OK.');
        }

        const today = new Date().toISOString().split('T')[0];
        const sampleAlerts = [];

        // Low stock alerts (productId, message)
        products.slice(0, 3).forEach((p, i) => {
            const avail = Math.max(0, (p.minStock || 10) - (i + 1) * 15);
            sampleAlerts.push({
                alertType: 'LOW_STOCK',
                severity: avail <= 0 ? 'CRITICAL' : 'WARN',
                productId: p.productId,
                batchId: null,
                message: `${p.name} (${p.sku}): low stock (${avail} available, min ${p.minStock || 10})`
            });
        });

        // Check for batches to create expiry alerts
        const [batches] = await db.execute(
            'SELECT b.batchId, b.productId, b.lotCode, b.quantity, b.expiryDate, p.name FROM batches b JOIN products p ON b.productId = p.productId WHERE b.quantity > 0 LIMIT 5'
        );

        batches.forEach(b => {
            const exp = b.expiryDate ? String(b.expiryDate).substring(0, 10) : null;
            if (exp) {
                if (exp < today) {
                    sampleAlerts.push({
                        alertType: 'EXPIRED',
                        severity: 'CRITICAL',
                        productId: b.productId,
                        batchId: b.batchId,
                        message: `${b.name} - Batch ${b.lotCode}: expired on ${exp} (${b.quantity} units)`
                    });
                } else {
                    sampleAlerts.push({
                        alertType: 'NEAR_EXPIRY',
                        severity: 'WARN',
                        productId: b.productId,
                        batchId: b.batchId,
                        message: `${b.name} - Batch ${b.lotCode}: expires ${exp} (${b.quantity} units)`
                    });
                }
            }
        });

        // If no batch-based alerts, add generic ones
        if (sampleAlerts.filter(a => a.alertType !== 'LOW_STOCK').length === 0 && products[0]) {
            sampleAlerts.push({
                alertType: 'NEAR_EXPIRY',
                severity: 'WARN',
                productId: products[0].productId,
                batchId: null,
                message: `${products[0].name}: some batches expiring within 7 days`
            });
            sampleAlerts.push({
                alertType: 'EXPIRED',
                severity: 'CRITICAL',
                productId: products[1] ? products[1].productId : products[0].productId,
                batchId: null,
                message: `${products[1] ? products[1].name : products[0].name}: batch has expired - dispose or review`
            });
        }

        // Insert (skip duplicates by checking existing)
        let inserted = 0;
        for (const a of sampleAlerts) {
            const [existing] = await db.execute(
                'SELECT 1 FROM alerts WHERE productId = ? AND alertType = ? AND message = ? AND resolved = FALSE LIMIT 1',
                [a.productId, a.alertType, a.message]
            );
            if (existing.length === 0) {
                await db.execute(
                    'INSERT INTO alerts (alertType, severity, productId, batchId, message) VALUES (?, ?, ?, ?, ?)',
                    [a.alertType, a.severity, a.productId, a.batchId, a.message]
                );
                inserted++;
                console.log('  +', a.alertType, '-', a.message.substring(0, 50) + '...');
            }
        }

        if (inserted === 0) {
            // Force insert minimal samples so the page has data
            console.log('Inserting minimal sample alerts...');
            for (const p of products.slice(0, 3)) {
                await db.execute(
                    'INSERT INTO alerts (alertType, severity, productId, message) VALUES (?, ?, ?, ?)',
                    ['LOW_STOCK', 'WARN', p.productId, `${p.name} (${p.sku}): low stock - restock soon`]
                );
                inserted++;
            }
            if (products[0]) {
                await db.execute(
                    'INSERT INTO alerts (alertType, severity, productId, message) VALUES (?, ?, ?, ?)',
                    ['NEAR_EXPIRY', 'WARN', products[0].productId, `${products[0].name}: batch expiring within 7 days`]
                );
                await db.execute(
                    'INSERT INTO alerts (alertType, severity, productId, message) VALUES (?, ?, ?, ?)',
                    ['EXPIRED', 'CRITICAL', products[0].productId, `${products[0].name}: expired batch - dispose or review`]
                );
                inserted += 2;
            }
        }

        const [count] = await db.execute('SELECT COUNT(*) as n FROM alerts WHERE resolved = FALSE');
        console.log(`\nDone. ${inserted} alert(s) added. Total active alerts: ${count[0].n}`);
    } catch (err) {
        console.error('Error:', err.message);
        process.exit(1);
    } finally {
        process.exit(0);
    }
}

seedAlerts();
