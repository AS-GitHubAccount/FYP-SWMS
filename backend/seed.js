#!/usr/bin/env node
// Demo data: SEED-* products, alerts, notifications, optional booking/PR. Run: node seed.js
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const db = require('./config/database');

const SEED_TAG = '[SEED]';
const SEED_SKU_PREFIX = 'SEED-';

function ymd(d) {
    return d.toISOString().slice(0, 10);
}

function daysFromToday(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return ymd(d);
}

async function columnExists(table, col) {
    const [r] = await db.execute(
        `SELECT COUNT(*) AS c FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
        [table, col]
    );
    return (r[0] && r[0].c) > 0;
}

async function tableExists(name) {
    const [r] = await db.execute(
        `SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?`,
        [name]
    );
    return (r[0] && r[0].c) > 0;
}

async function getSeedProductIds() {
    const [rows] = await db.execute(
        `SELECT productId FROM products WHERE sku LIKE ?`,
        [`${SEED_SKU_PREFIX}%`]
    );
    return (rows || []).map((x) => x.productId);
}

async function cleanupPreviousSeed() {
    const pids = await getSeedProductIds();
    if (pids.length) {
        const placeholders = pids.map(() => '?').join(',');
        await db.execute(`DELETE FROM batches WHERE productId IN (${placeholders})`, pids);
        await db.execute(`DELETE FROM inventory_items WHERE productId IN (${placeholders})`, pids);
        await db.execute(`DELETE FROM alerts WHERE productId IN (${placeholders})`, pids);
    }
    await db.execute(`DELETE FROM products WHERE sku LIKE ?`, [`${SEED_SKU_PREFIX}%`]);

    await db.execute(`DELETE FROM notifications WHERE message LIKE ?`, [`${SEED_TAG}%`]);
    await db.execute(`DELETE FROM alerts WHERE message LIKE ?`, [`${SEED_TAG}%`]);

    if (await tableExists('bookings')) {
        try {
            await db.execute(`DELETE FROM bookings WHERE notes = ?`, ['[SEED]']);
        } catch (e) {
            /* notes column optional */
        }
    }
    if (await tableExists('purchase_requests')) {
        try {
            await db.execute(`DELETE FROM purchase_requests WHERE notes = ?`, ['[SEED]']);
        } catch (e) {}
    }
    console.log('Cleaned previous seed markers (SEED-* products, [SEED] notifications/alerts).');
}

async function seedPendingInviteUser() {
    const email = 'pending.seed@swms.local';
    const { generateInviteToken, hashInviteToken, defaultInviteExpiry, getFrontendBaseUrl } = require('./utils/userInviteTokens');
    try {
        await db.execute('DELETE FROM users WHERE LOWER(email) = ?', [email]);
    } catch (e) {
        console.warn('Could not remove old seed pending user:', e.message);
    }
    const rawToken = generateInviteToken();
    const tokenHash = hashInviteToken(rawToken);
    const exp = defaultInviteExpiry();
    try {
        await db.execute(
            `INSERT INTO users (name, email, passwordHash, role, accountStatus, inviteTokenHash, inviteTokenExpires)
       VALUES (?, ?, NULL, 'STAFF', 'PENDING_INVITE', ?, ?)`,
            ['SEED — Pending Invite', email, tokenHash, exp]
        );
    } catch (e) {
        if (e.code === 'ER_BAD_FIELD_ERROR') {
            await db.execute(`INSERT INTO users (name, email, passwordHash, role) VALUES (?, ?, NULL, 'STAFF')`, [
                'SEED — Pending Invite',
                email
            ]);
            const [rows] = await db.execute('SELECT userId FROM users WHERE LOWER(email) = ?', [email]);
            if (rows && rows[0]) {
                try {
                    await db.execute(
                        `UPDATE users SET inviteTokenHash = ?, inviteTokenExpires = ?, accountStatus = 'PENDING_INVITE' WHERE userId = ?`,
                        [tokenHash, exp, rows[0].userId]
                    );
                } catch (e2) {
                    console.warn('Pending user created but invite columns missing:', e2.message);
                }
            }
        } else {
            throw e;
        }
    }
    console.log(`SEED pending-invite user: ${email} (set password via link before login)`);
    console.log(`   Dev set-password link: ${getFrontendBaseUrl()}/set-password.html?token=${rawToken}`);
}

async function upsertProduct({ sku, name, category, minStock }) {
    const hasPT = await columnExists('products', 'productType');
    if (hasPT) {
        await db.execute(
            `INSERT INTO products (sku, name, category, unit, minStock, productType)
       VALUES (?, ?, ?, 'unit', ?, 'GOODS')
       ON DUPLICATE KEY UPDATE name = VALUES(name), category = VALUES(category), minStock = VALUES(minStock), productType = VALUES(productType)`,
            [sku, name, category, minStock]
        );
    } else {
        await db.execute(
            `INSERT INTO products (sku, name, category, unit, minStock)
       VALUES (?, ?, ?, 'unit', ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), category = VALUES(category), minStock = VALUES(minStock)`,
            [sku, name, category, minStock]
        );
    }
    const [r] = await db.execute('SELECT productId FROM products WHERE sku = ?', [sku]);
    return r[0].productId;
}

async function setInventory(productId, totalQty, available, reserved, location) {
    const hasLoc = await columnExists('inventory_items', 'location');
    if (hasLoc) {
        await db.execute(
            `INSERT INTO inventory_items (productId, totalQty, available, reserved, location)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE totalQty = VALUES(totalQty), available = VALUES(available), reserved = VALUES(reserved), location = VALUES(location)`,
            [productId, totalQty, available, reserved, location || 'Main Warehouse']
        );
    } else {
        await db.execute(
            `INSERT INTO inventory_items (productId, totalQty, available, reserved)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE totalQty = VALUES(totalQty), available = VALUES(available), reserved = VALUES(reserved)`,
            [productId, totalQty, available, reserved]
        );
    }
}

async function upsertBatch(productId, lotCode, quantity, expiryDate, location) {
    const hasLoc = await columnExists('batches', 'location');
    const hasRD = await columnExists('batches', 'receivedDate');
    if (hasLoc && hasRD) {
        await db.execute(
            `INSERT INTO batches (productId, lotCode, quantity, expiryDate, receivedDate, location)
       VALUES (?, ?, ?, ?, CURDATE(), ?)
       ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), expiryDate = VALUES(expiryDate), location = VALUES(location)`,
            [productId, lotCode, quantity, expiryDate, location || 'Aisle SEED']
        );
    } else if (hasLoc) {
        await db.execute(
            `INSERT INTO batches (productId, lotCode, quantity, expiryDate, location)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), expiryDate = VALUES(expiryDate), location = VALUES(location)`,
            [productId, lotCode, quantity, expiryDate, location || 'Aisle SEED']
        );
    } else {
        await db.execute(
            `INSERT INTO batches (productId, lotCode, quantity, expiryDate)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), expiryDate = VALUES(expiryDate)`,
            [productId, lotCode, quantity, expiryDate]
        );
    }
}

async function insertNotification(userId, recipientName, type, notificationType, message, relatedEntityType, relatedEntityId) {
    try {
        await db.execute(
            `INSERT INTO notifications (userId, type, notificationType, message, recipient, relatedEntityType, relatedEntityId, rejectionReason, isRead)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, FALSE)`,
            [userId, type, notificationType, message, recipientName, relatedEntityType || null, relatedEntityId || null]
        );
    } catch (e) {
        if (e.code === 'ER_BAD_FIELD_ERROR') {
            await db.execute(
                `INSERT INTO notifications (userId, message, recipient, isRead) VALUES (?, ?, ?, FALSE)`,
                [userId, message, recipientName]
            );
        } else {
            throw e;
        }
    }
}

async function main() {
    console.log('SWMS seed.js — connecting…');
    try {
        await db.execute('SELECT 1');
    } catch (e) {
        console.error('Database connection failed:', e.message);
        console.error('   Fix .env (DB_HOST, DB_USER, DB_PASSWORD, DB_NAME) and ensure MySQL is running.');
        process.exit(1);
    }

    await cleanupPreviousSeed();

    const { ensureUserInvitationColumns } = require('./utils/ensureUserInvitationColumns');
    await ensureUserInvitationColumns();

    const pidExpired = await upsertProduct({
        sku: `${SEED_SKU_PREFIX}EXPIRED-001`,
        name: 'SEED — All batches expired (demo)',
        category: 'Seed Demo',
        minStock: 15
    });
    await setInventory(pidExpired, 60, 60, 0, 'Cold Room SEED');
    await upsertBatch(pidExpired, `${SEED_SKU_PREFIX}LOT-EXP-A`, 35, daysFromToday(-45));
    await upsertBatch(pidExpired, `${SEED_SKU_PREFIX}LOT-EXP-B`, 25, daysFromToday(-10));

    const pidLow = await upsertProduct({
        sku: `${SEED_SKU_PREFIX}LOW-001`,
        name: 'SEED — Low stock vs minimum',
        category: 'Seed Demo',
        minStock: 80
    });
    await setInventory(pidLow, 42, 42, 0, 'Main SEED');
    await upsertBatch(pidLow, `${SEED_SKU_PREFIX}LOT-LOW-1`, 42, daysFromToday(180));

    const pidNear = await upsertProduct({
        sku: `${SEED_SKU_PREFIX}NEAR-001`,
        name: 'SEED — Near expiry batch',
        category: 'Seed Demo',
        minStock: 5
    });
    await setInventory(pidNear, 120, 120, 0, 'Shelf SEED');
    await upsertBatch(pidNear, `${SEED_SKU_PREFIX}LOT-NEAR`, 120, daysFromToday(12));

    const pidOk = await upsertProduct({
        sku: `${SEED_SKU_PREFIX}OK-001`,
        name: 'SEED — Healthy stock levels',
        category: 'Seed Demo',
        minStock: 10
    });
    await setInventory(pidOk, 500, 500, 0, 'Bulk SEED');
    await upsertBatch(pidOk, `${SEED_SKU_PREFIX}LOT-OK`, 500, daysFromToday(400));

    const pidOut = await upsertProduct({
        sku: `${SEED_SKU_PREFIX}OUT-001`,
        name: 'SEED — Out of stock',
        category: 'Seed Demo',
        minStock: 20
    });
    await setInventory(pidOut, 0, 0, 0, 'Main SEED');

    console.log('Seeded products, inventory_items, batches.');

    const alertRows = [
        {
            alertType: 'EXPIRED',
            severity: 'CRITICAL',
            productId: pidExpired,
            message: `${SEED_TAG} SEED — All batches expired (demo): dispose or write off expired lots.`
        },
        {
            alertType: 'LOW_STOCK',
            severity: 'WARN',
            productId: pidLow,
            message: `${SEED_TAG} SEED — Low stock: valid quantity is at or below minimum — reorder.`
        },
        {
            alertType: 'NEAR_EXPIRY',
            severity: 'WARN',
            productId: pidNear,
            message: `${SEED_TAG} SEED — Near expiry: batch expires within 30 days — use or discount.`
        },
        {
            alertType: 'LOW_STOCK',
            severity: 'INFO',
            productId: pidOk,
            message: `${SEED_TAG} SEED — FYI: monitor fast movers (demo alert).`
        }
    ];

    for (const a of alertRows) {
        try {
            await db.execute(
                `INSERT INTO alerts (alertType, severity, productId, batchId, message, resolved) VALUES (?, ?, ?, NULL, ?, FALSE)`,
                [a.alertType, a.severity, a.productId, a.message]
            );
        } catch (err) {
            if (String(err.message || '').includes('alertType')) {
                await db.execute(
                    `INSERT INTO alerts (alertType, severity, productId, message, resolved) VALUES ('LOW_STOCK', 'WARN', ?, ?, FALSE)`,
                    [a.productId, a.message]
                );
            } else {
                console.warn('Alert insert skipped:', err.message);
            }
        }
    }
    console.log('Seeded alerts.');

    await seedPendingInviteUser();

    const [users] = await db.execute(`SELECT userId, name, role FROM users ORDER BY userId`);
    if (!users.length) {
        console.error('No users in DB. Run setup.sql or register, then seed again.');
        process.exit(1);
    }

    const adminUser = users.find((u) => String(u.role || '').toUpperCase() === 'ADMIN') || users[0];
    const adminId = adminUser.userId;

    if (await tableExists('bookings')) {
        try {
            const { generateBookingNumber } = require('./utils/idGenerator');
            const bkNum = await generateBookingNumber();
            await db.execute(
                `INSERT INTO bookings (bookingNumber, productId, quantity, requestedBy, neededBy, status, notes)
         VALUES (?, ?, 5, ?, ?, 'PENDING', '[SEED]')`,
                [bkNum, pidOk, adminId, daysFromToday(7)]
            );
            console.log('Seeded pending booking:', bkNum);
        } catch (e) {
            console.warn('Booking seed skipped:', e.message);
        }
    }

    if (await tableExists('purchase_requests')) {
        try {
            const { generateRequestNumber } = require('./utils/idGenerator');
            const prNum = await generateRequestNumber('purchase');
            await db.execute(
                `INSERT INTO purchase_requests (requestNumber, productId, quantity, requestedBy, neededBy, status, priority, notes)
         VALUES (?, ?, 24, ?, ?, 'PENDING', 'high', '[SEED]')`,
                [prNum, pidLow, adminId, daysFromToday(14)]
            );
            console.log('Seeded pending purchase request:', prNum);
        } catch (e) {
            console.warn('Purchase request seed skipped:', e.message);
        }
    }

    const templates = [
        { type: 'Alert', ntype: 'WARNING', relT: 'alert', msg: `${SEED_TAG} Low stock: SEED — Low stock vs minimum is below target. Open Alerts or Inventory.` },
        { type: 'Alert', ntype: 'WARNING', relT: null, msg: `${SEED_TAG} Expired inventory: review SEED — All batches expired (demo) for disposal workflow.` },
        { type: 'Request', ntype: 'INFO', relT: null, msg: `${SEED_TAG} New booking pending approval (see Dashboard Action Items).` },
        { type: 'Request', ntype: 'INFO', relT: null, msg: `${SEED_TAG} Purchase request awaiting approval — check Approval or Purchasing.` },
        { type: 'Result', ntype: 'SUCCESS', relT: null, msg: `${SEED_TAG} Receiving: inbound check completed for demo lane (view Received Records).` },
        { type: 'Request', ntype: 'INFO', relT: null, msg: `${SEED_TAG} Issuing: pick list ready for outbound demo (Issuing tab).` },
        {
            type: 'Request',
            ntype: 'INFO',
            relT: 'rfq',
            relId: null,
            msg: `${SEED_TAG} New quote: $42.50 from Demo Supplier — 8.2% below 12-mo avg ($46.32) — strong vs history. Open Purchasing → Compare.`
        },
        { type: 'Alert', ntype: 'INFO', relT: null, msg: `${SEED_TAG} Near expiry: batch on SEED — Near expiry batch within 30 days.` },
        { type: 'Request', ntype: 'INFO', relT: null, msg: `${SEED_TAG} System: seed data loaded. Safe to delete [SEED] notifications anytime.` },
        { type: 'Alert', ntype: 'WARNING', relT: null, msg: `${SEED_TAG} Dashboard: Action Items should list bookings, alerts, and low-stock highlights after refresh.` }
    ];

    let notifCount = 0;
    for (const u of users) {
        const recipient = u.name || (String(u.role).toUpperCase() === 'ADMIN' ? 'Admin' : 'Staff');
        for (const t of templates) {
            await insertNotification(
                u.userId,
                recipient,
                t.type,
                t.ntype,
                t.msg,
                t.relT || null,
                t.relId != null ? t.relId : null
            );
            notifCount++;
        }
    }

    console.log(`Seeded ${notifCount} unread notifications for ${users.length} user(s).`);
    console.log('Done. Re-run: node seed.js (cleans old [SEED] first).');
}

main()
    .catch((e) => {
        console.error('Seed failed:', e);
        process.exitCode = 1;
    })
    .finally(async () => {
        try {
            if (typeof db.end === 'function') await db.end();
        } catch (_) {}
        process.exit(process.exitCode || 0);
    });
