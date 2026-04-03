/**
 * Migrate existing records to TYPE-yymm-xxxx reference ID format.
 * 
 * Format: TYPE-yymm-xxxx (e.g. BK-2511-0002)
 * - Orders records by date (requestedDate, receivedDate, etc.) then by PK
 * - Assigns sequence 0001, 0002, ... within each type+month
 * 
 * Run: node migrations/migrate_reference_ids.js
 * Or from backend/: node migrations/migrate_reference_ids.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mysql = require('mysql2/promise');

const CONFIGS = [
    {
        type: 'BK',
        table: 'bookings',
        idColumn: 'bookingId',
        numberColumn: 'bookingNumber',
        dateColumn: 'requestedDate'
    },
    {
        type: 'IN',
        table: 'in_records',
        idColumn: 'recordId',
        numberColumn: 'recordNumber',
        dateColumn: 'receivedDate'
    },
    {
        type: 'OUT',
        table: 'out_records',
        idColumn: 'recordId',
        numberColumn: 'recordNumber',
        dateColumn: 'issuedDate'
    },
    {
        type: 'PR',
        table: 'purchase_requests',
        idColumn: 'requestId',
        numberColumn: 'requestNumber',
        dateColumn: 'requestedDate'
    },
    {
        type: 'DR',
        table: 'disposal_requests',
        idColumn: 'disposalId',
        numberColumn: 'requestNumber',
        dateColumn: 'requestedDate'
    },
    {
        type: 'RFQ',
        table: 'rfqs',
        idColumn: 'rfqId',
        numberColumn: 'rfqNumber',
        dateColumn: 'createdAt',
        dateExpr: 'DATE(createdAt)'
    },
    {
        type: 'PO',
        table: 'purchase_orders',
        idColumn: 'poId',
        numberColumn: 'poNumber',
        dateColumn: 'orderDate',
        dateExpr: 'COALESCE(orderDate, DATE(createdAt), CURDATE())'
    }
];

async function migrate() {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST || '127.0.0.1',
        port: process.env.DB_PORT || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || 'root',
        database: process.env.DB_NAME || 'swms_db'
    });

    for (const cfg of CONFIGS) {
        try {
            const dateExpr = cfg.dateExpr || cfg.dateColumn;
            const [rows] = await conn.execute(
                `SELECT \`${cfg.idColumn}\` as id, ${dateExpr} as dt 
                 FROM \`${cfg.table}\` 
                 ORDER BY ${dateExpr} ASC, \`${cfg.idColumn}\` ASC`
            );

            if (rows.length === 0) {
                console.log(`[${cfg.type}] ${cfg.table}: no records`);
                continue;
            }

            // Group by yymm and assign sequence
            const seqByYymm = {};
            const updates = [];

            for (const row of rows) {
                const d = row.dt ? new Date(row.dt) : new Date();
                const yy = String(d.getFullYear()).slice(-2);
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const yymm = yy + mm;

                seqByYymm[yymm] = (seqByYymm[yymm] || 0) + 1;
                const seq = seqByYymm[yymm];
                const newNumber = `${cfg.type}-${yymm}-${String(seq).padStart(4, '0')}`;
                updates.push({ id: row.id, newNumber });
            }

            // Use temp column to avoid unique constraint conflicts during update
            const tempCol = '_mig_tmp_' + cfg.numberColumn;
            try {
                await conn.execute(`ALTER TABLE \`${cfg.table}\` ADD COLUMN \`${tempCol}\` VARCHAR(50) NULL`);
            } catch (e) {
                if (e.code === 'ER_DUP_FIELDNAME') {
                    await conn.execute(`UPDATE \`${cfg.table}\` SET \`${tempCol}\` = NULL`);
                } else throw e;
            }

            for (const u of updates) {
                await conn.execute(
                    `UPDATE \`${cfg.table}\` SET \`${tempCol}\` = ? WHERE \`${cfg.idColumn}\` = ?`,
                    [u.newNumber, u.id]
                );
            }

            await conn.execute(
                `UPDATE \`${cfg.table}\` SET \`${cfg.numberColumn}\` = \`${tempCol}\` WHERE \`${tempCol}\` IS NOT NULL`
            );
            await conn.execute(`ALTER TABLE \`${cfg.table}\` DROP COLUMN \`${tempCol}\``);

            console.log(`[${cfg.type}] ${cfg.table}: migrated ${updates.length} records`);
        } catch (e) {
            if (e.code === 'ER_NO_SUCH_TABLE') {
                console.log(`[${cfg.type}] ${cfg.table}: table does not exist, skip`);
            } else {
                console.error(`[${cfg.type}] ${cfg.table}:`, e.message);
                throw e;
            }
        }
    }

    console.log('Migration complete.');
    await conn.end();
}

migrate().catch(err => {
    console.error(err);
    process.exit(1);
});
