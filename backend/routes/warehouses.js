// /api/warehouses
const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { requireAdmin } = require('../middleware/auth');
function getStatus(row) {
    if (row == null) return 'Active';
    if (row.status != null && String(row.status).trim() !== '') return String(row.status).trim();
    return row.isActive === false || row.isActive === 0 ? 'Inactive' : 'Active';
}

router.get('/', async (req, res) => {
    try {
        let rows;
        try {
            [rows] = await db.execute('SELECT * FROM warehouses ORDER BY name');
        } catch (colErr) {
            if (colErr.code === 'ER_NO_SUCH_TABLE') return res.json({ success: true, data: [] });
            throw colErr;
        }
        const data = (rows || []).map(r => ({ ...r, status: getStatus(r) }));
        res.json({ success: true, data });
    } catch (e) {
        if (e.code === 'ER_NO_SUCH_TABLE') return res.json({ success: true, data: [] });
        res.status(500).json({ success: false, error: e.message });
    }
});

router.get('/active', async (req, res) => {
    try {
        let rows;
        try {
            [rows] = await db.execute('SELECT * FROM warehouses ORDER BY name');
        } catch (colErr) {
            if (colErr.code === 'ER_NO_SUCH_TABLE') return res.json({ success: true, data: [] });
            throw colErr;
        }
        const active = (rows || []).filter(r => getStatus(r) === 'Active');
        res.json({ success: true, data: active });
    } catch (e) {
        if (e.code === 'ER_NO_SUCH_TABLE') return res.json({ success: true, data: [] });
        res.status(500).json({ success: false, error: e.message });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const [rows] = await db.execute('SELECT * FROM warehouses WHERE warehouseId = ?', [id]);
        if (!rows.length) return res.status(404).json({ success: false, error: 'Warehouse not found' });
        const row = rows[0];
        res.json({ success: true, data: { ...row, status: getStatus(row) } });
    } catch (e) {
        if (e.code === 'ER_NO_SUCH_TABLE') return res.status(503).json({ success: false, error: 'Warehouses table not created.' });
        res.status(500).json({ success: false, error: e.message });
    }
});

router.put('/:id', requireAdmin, async (req, res) => {
    try {
        const id = req.params.id;
        const { name, code, address } = req.body || {};
        if (!name || !code) return res.status(400).json({ success: false, error: 'name and code required' });
        const [existing] = await db.execute('SELECT * FROM warehouses WHERE warehouseId = ?', [id]);
        if (!existing.length) return res.status(404).json({ success: false, error: 'Warehouse not found' });
        const row = existing[0];
        const codeNorm = String(code).trim();
        const nameNorm = String(name).trim();
        const [dup] = await db.execute(
            'SELECT warehouseId FROM warehouses WHERE UPPER(TRIM(code)) = UPPER(?) AND warehouseId != ?',
            [codeNorm, id]
        );
        if (dup.length) {
            return res.status(400).json({ success: false, error: 'A warehouse with this code already exists. Use a unique code.' });
        }
        await db.execute(
            'UPDATE warehouses SET name = ?, code = ?, address = ? WHERE warehouseId = ?',
            [nameNorm, codeNorm, address != null && String(address).trim() !== '' ? String(address).trim() : null, id]
        );
        const [updated] = await db.execute('SELECT * FROM warehouses WHERE warehouseId = ?', [id]);
        res.json({ success: true, data: { ...updated[0], status: getStatus(updated[0]) } });
    } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ success: false, error: 'A warehouse with this code already exists. Use a unique code.' });
        }
        res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/', requireAdmin, async (req, res) => {
    try {
        const { name, code, address } = req.body;
        if (!name || !code) return res.status(400).json({ success: false, error: 'name and code required' });
        const [r] = await db.execute(
            'INSERT INTO warehouses (name, code, address) VALUES (?, ?, ?)',
            [name, code, address || null]
        );
        const [rows] = await db.execute('SELECT * FROM warehouses WHERE warehouseId = ?', [r.insertId]);
        res.status(201).json({ success: true, data: rows[0] });
    } catch (e) {
        if (e.code === 'ER_NO_SUCH_TABLE') return res.status(503).json({ success: false, error: 'Warehouses table not created. Run migrations.' });
        if (e.code === 'ER_DUP_ENTRY') return res.status(400).json({ success: false, error: 'A warehouse with this code already exists. Use a unique code.' });
        res.status(500).json({ success: false, error: e.message });
    }
});

router.put('/:id/toggle-status', requireAdmin, async (req, res) => {
    try {
        const id = req.params.id;
        const [existing] = await db.execute('SELECT * FROM warehouses WHERE warehouseId = ?', [id]);
        if (!existing.length) return res.status(404).json({ success: false, error: 'Warehouse not found' });
        const row = existing[0];
        const currentStatus = getStatus(row);
        const newStatus = currentStatus === 'Active' ? 'Inactive' : 'Active';
        const isActive = newStatus === 'Active' ? 1 : 0;
        try {
            await db.execute(
                'UPDATE warehouses SET status = ?, isActive = ? WHERE warehouseId = ?',
                [newStatus, isActive, id]
            );
        } catch (colErr) {
            if (colErr.code === 'ER_BAD_FIELD_ERROR' && colErr.message && colErr.message.includes('status')) {
                await db.execute('UPDATE warehouses SET isActive = ? WHERE warehouseId = ?', [isActive, id]);
            } else throw colErr;
        }
        const [updated] = await db.execute('SELECT * FROM warehouses WHERE warehouseId = ?', [id]);
        res.json({ success: true, data: { ...updated[0], status: newStatus } });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.delete('/:id', requireAdmin, async (req, res) => {
    try {
        const id = req.params.id;
        const [existing] = await db.execute('SELECT * FROM warehouses WHERE warehouseId = ?', [id]);
        if (!existing.length) return res.status(404).json({ success: false, error: 'Warehouse not found' });

        let totalLinked = 0;
        const tables = [
            { table: 'inventory_items', col: 'warehouseId' },
            { table: 'in_records', col: 'warehouseId' },
            { table: 'out_records', col: 'warehouseId' }
        ];
        for (const { table, col } of tables) {
            try {
                const [[r]] = await db.execute(`SELECT COUNT(*) AS c FROM ${table} WHERE ${col} = ?`, [id]);
                totalLinked += (r && r.c) ? Number(r.c) : 0;
            } catch (err) {
                if (err.code === 'ER_BAD_FIELD_ERROR') { /* column may not exist */ }
                else throw err;
            }
        }
        if (totalLinked > 0) {
            return res.status(400).json({
                success: false,
                error: 'Cannot delete warehouse with existing transaction history. Please deactivate it instead.'
            });
        }

        await db.execute('DELETE FROM warehouses WHERE warehouseId = ?', [id]);
        res.json({ success: true, message: 'Warehouse deleted.' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
