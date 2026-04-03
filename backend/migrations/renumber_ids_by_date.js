/**
 * Renumber primary key IDs to follow creation/date order.
 * 
 * After migration: ID 1 = earliest by date, ID 2 = second, etc.
 * Gaps indicate deleted records (easier to spot issues).
 * 
 * Run: node migrations/renumber_ids_by_date.js
 * Or from backend/: node migrations/renumber_ids_by_date.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mysql = require('mysql2/promise');

// Order: parents before children (PR -> RFQ -> Quotations -> PO, Bookings -> Out)
const CONFIGS = [
    { table: 'purchase_requests', idColumn: 'requestId', dateExpr: 'COALESCE(requestedDate, createdAt)', childRefs: [{ table: 'rfqs', fkColumn: 'purchaseRequestId' }, { table: 'purchase_orders', fkColumn: 'purchaseRequestId' }] },
    { table: 'rfqs', idColumn: 'rfqId', dateExpr: 'COALESCE(DATE(createdAt), CURDATE())', childRefs: [{ table: 'quotations', fkColumn: 'rfqId' }, { table: 'rfq_suppliers', fkColumn: 'rfqId' }, { table: 'purchase_orders', fkColumn: 'rfqId' }] },
    { table: 'quotations', idColumn: 'quotationId', dateExpr: 'COALESCE(DATE(submittedAt), CURDATE())', childRefs: [{ table: 'purchase_orders', fkColumn: 'quotationId' }] },
    { table: 'purchase_orders', idColumn: 'poId', dateExpr: 'COALESCE(orderDate, DATE(createdAt), CURDATE())', childRefs: [] },
    { table: 'bookings', idColumn: 'bookingId', dateExpr: 'requestedDate', childRefs: [{ table: 'out_records', fkColumn: 'bookingId' }] },
    { table: 'out_records', idColumn: 'recordId', dateExpr: 'issuedDate', childRefs: [] },
    { table: 'in_records', idColumn: 'recordId', dateExpr: 'receivedDate', childRefs: [] },
    { table: 'disposal_requests', idColumn: 'disposalId', dateExpr: 'requestedDate', childRefs: [] }
];

async function renumberTable(conn, cfg) {
    try {
        const [rows] = await conn.execute(
            `SELECT \`${cfg.idColumn}\` as id FROM \`${cfg.table}\` ORDER BY ${cfg.dateExpr} ASC, \`${cfg.idColumn}\` ASC`
        );
        if (rows.length === 0) return false;

        const oldToNew = {};
        rows.forEach((r, i) => { oldToNew[r.id] = i + 1; });

        const offset = 1000000;

        await conn.execute('SET FOREIGN_KEY_CHECKS = 0');

        // 1. Update child FKs to offset+newId (so they point to temp values)
        for (const ref of cfg.childRefs) {
            try {
                for (const [oldId, newId] of Object.entries(oldToNew)) {
                    await conn.execute(
                        `UPDATE \`${ref.table}\` SET \`${ref.fkColumn}\` = ? WHERE \`${ref.fkColumn}\` = ?`,
                        [offset + newId, oldId]
                    );
                }
            } catch (e) {
                if (e.code !== 'ER_NO_SUCH_TABLE' && e.code !== 'ER_BAD_FIELD_ERROR') throw e;
            }
        }

        // 2. Move parent PKs to offset+newId (free up 1,2,3...)
        for (const [oldId, newId] of Object.entries(oldToNew)) {
            await conn.execute(
                `UPDATE \`${cfg.table}\` SET \`${cfg.idColumn}\` = ? WHERE \`${cfg.idColumn}\` = ?`,
                [offset + newId, oldId]
            );
        }

        // 3. Move parent PKs to final newId (1, 2, 3...)
        for (const [_, newId] of Object.entries(oldToNew)) {
            await conn.execute(
                `UPDATE \`${cfg.table}\` SET \`${cfg.idColumn}\` = ? WHERE \`${cfg.idColumn}\` = ?`,
                [newId, offset + newId]
            );
        }

        // 4. Update child FKs from offset+newId to newId
        for (const ref of cfg.childRefs) {
            try {
                for (const [_, newId] of Object.entries(oldToNew)) {
                    await conn.execute(
                        `UPDATE \`${ref.table}\` SET \`${ref.fkColumn}\` = ? WHERE \`${ref.fkColumn}\` = ?`,
                        [newId, offset + newId]
                    );
                }
            } catch (e) {
                if (e.code !== 'ER_NO_SUCH_TABLE' && e.code !== 'ER_BAD_FIELD_ERROR') throw e;
            }
        }

        const maxId = Math.max(...Object.values(oldToNew));
        await conn.execute(`ALTER TABLE \`${cfg.table}\` AUTO_INCREMENT = ${maxId + 1}`);
        await conn.execute('SET FOREIGN_KEY_CHECKS = 1');

        return true;
    } catch (e) {
        await conn.execute('SET FOREIGN_KEY_CHECKS = 1');
        throw e;
    }
}

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
            await conn.execute(`SELECT 1 FROM \`${cfg.table}\` LIMIT 1`);
        } catch (e) {
            if (e.code === 'ER_NO_SUCH_TABLE') {
                console.log(`[skip] ${cfg.table}: table does not exist`);
                continue;
            }
            throw e;
        }

        try {
            const ok = await renumberTable(conn, cfg);
            if (ok) {
                const [rows] = await conn.execute(`SELECT COUNT(*) as c FROM \`${cfg.table}\``);
                console.log(`[OK] ${cfg.table}: renumbered ${rows[0].c} records (IDs now follow date order)`);
            } else {
                console.log(`[skip] ${cfg.table}: no records`);
            }
        } catch (e) {
            console.error(`[FAIL] ${cfg.table}:`, e.message);
            throw e;
        }
    }

    console.log('Renumbering complete. IDs now follow creation/date order.');
    await conn.end();
}

migrate().catch(err => {
    console.error(err);
    process.exit(1);
});
