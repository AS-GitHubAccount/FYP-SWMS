/**
 * Ensures warehouses table exists. Run at server startup (non-blocking).
 */
const db = require('./config/database');

async function ensureWarehousesTable() {
    try {
        await db.execute(`
            CREATE TABLE IF NOT EXISTS warehouses (
                warehouseId INT PRIMARY KEY AUTO_INCREMENT,
                name VARCHAR(255) NOT NULL,
                code VARCHAR(50) UNIQUE NOT NULL,
                address TEXT,
                isActive BOOLEAN DEFAULT TRUE,
                status VARCHAR(20) NOT NULL DEFAULT 'Active',
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        const [rows] = await db.execute('SELECT 1 FROM warehouses LIMIT 1');
        if (!rows || rows.length === 0) {
            await db.execute(
                `INSERT INTO warehouses (name, code, address) VALUES ('Main Warehouse', 'MAIN', 'Default location')`
            );
        }
    } catch (err) {
        console.error('ensureWarehousesTable:', err.message);
    }
}

module.exports = { ensureWarehousesTable };
