/**
 * Run enhancement migrations (adds columns that may not exist)
 * Run: node scripts/run-migrations.js
 */
const db = require('../config/database');

async function run() {
    const alters = [
        ['bookings', 'rejectReason', 'TEXT NULL'],
        ['bookings', 'orderRequester', 'VARCHAR(255) NULL COMMENT "Person/team who requested (e.g. Dancy - Finance Team)"'],
        ['bookings', 'deliveryTo', 'VARCHAR(255) NULL COMMENT "Delivery destination/location"'],
        ['bookings', 'issuing_id', 'INT NULL'],
        ['products', 'supplierId', 'INT NULL'],
        ['inventory_items', 'warehouseId', 'INT NULL'],
        ['warehouses', 'status', "VARCHAR(20) NOT NULL DEFAULT 'Active'"],
        ['in_records', 'warehouseId', 'INT NULL'],
        ['out_records', 'warehouseId', 'INT NULL'],
    ];
    for (const [table, col, def] of alters) {
        try {
            await db.execute(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
            console.log(`Added ${table}.${col}`);
        } catch (e) {
            if (e.code === 'ER_DUP_FIELDNAME') console.log(`${table}.${col} already exists, skipping`);
            else console.error(`Failed ${table}.${col}:`, e.message);
        }
    }
    // Booking–Issuing FK (out_records PK is recordId, not id)
    try {
        await db.execute('ALTER TABLE bookings ADD CONSTRAINT fk_booking_issuing FOREIGN KEY (issuing_id) REFERENCES out_records(recordId)');
        console.log('Added FK fk_booking_issuing');
    } catch (e) {
        if (e.code === 'ER_DUP_KEYNAME' || e.code === 'ER_FK_DUP_NAME' || (e.message && e.message.includes('Duplicate'))) console.log('FK fk_booking_issuing already exists, skipping');
        else console.error('FK fk_booking_issuing:', e.message);
    }
    console.log('Migrations done.');
    process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
