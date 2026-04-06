/**
 * Ensures suppliers.notes exists (TEXT) for UI notes field.
 */
const db = require('../config/database');

async function columnExists(table, col) {
    const [r] = await db.execute(
        `SELECT COUNT(*) AS c FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
        [table, col]
    );
    return (r[0] && r[0].c) > 0;
}

async function ensureSupplierNotesColumn() {
    try {
        if (!(await columnExists('suppliers', 'notes'))) {
            await db.execute('ALTER TABLE suppliers ADD COLUMN notes TEXT NULL');
            console.log('[ensureSupplierNotesColumn] Added suppliers.notes');
        }
    } catch (err) {
        console.warn('[ensureSupplierNotesColumn]', err.message);
    }
}

module.exports = { ensureSupplierNotesColumn };
