/**
 * Suppliers API Routes
 *
 * Handles supplier management:
 * - GET /api/suppliers - Get all suppliers
 * - GET /api/suppliers/:id - Get supplier by ID
 * - POST /api/suppliers - Create new supplier
 * - PUT /api/suppliers/:id - Update supplier
 * - DELETE /api/suppliers/:id - Delete supplier
 */

const express = require('express');
const router = express.Router();
const db = require('../config/database');

/**
 * Clears rows that reference suppliers.supplierId with ON DELETE RESTRICT
 * (e.g. purchase_orders, purchase_requests) so the supplier row can be removed.
 * rfq_suppliers / quotations / supplier_products typically CASCADE on supplier delete.
 */
async function unlinkSupplierReferences(conn, supplierId) {
    try {
        await conn.execute(
            `DELETE ph FROM price_history ph
             INNER JOIN purchase_orders po ON ph.poId = po.poId
             WHERE po.supplierId = ?`,
            [supplierId]
        );
    } catch (e) {
        if (e.code !== 'ER_NO_SUCH_TABLE' && e.errno !== 1146) throw e;
    }
    try {
        await conn.execute('UPDATE price_history SET supplierId = NULL WHERE supplierId = ?', [supplierId]);
    } catch (e) {
        if (e.code !== 'ER_NO_SUCH_TABLE' && e.errno !== 1146) throw e;
    }
    await conn.execute('DELETE FROM purchase_orders WHERE supplierId = ?', [supplierId]);
    try {
        await conn.execute('DELETE FROM purchase_request_suppliers WHERE supplierId = ?', [supplierId]);
    } catch (e) {
        if (e.code !== 'ER_NO_SUCH_TABLE' && e.errno !== 1146) throw e;
    }
    try {
        await conn.execute('UPDATE purchase_requests SET supplierId = NULL WHERE supplierId = ?', [supplierId]);
    } catch (e) {
        if (e.code !== 'ER_NO_SUCH_TABLE' && e.errno !== 1146) throw e;
    }
    try {
        await conn.execute('UPDATE products SET supplierId = NULL WHERE supplierId = ?', [supplierId]);
    } catch (e) {
        if (e.code !== 'ER_BAD_FIELD_ERROR' && e.errno !== 1054) throw e;
    }
}

router.get('/', async (req, res) => {
    try {
        const [suppliers] = await db.execute(
            'SELECT supplierId, name, contactPerson, email, phone, address, notes, status, createdAt FROM suppliers ORDER BY name ASC'
        );

        res.json({
            success: true,
            data: suppliers,
            count: suppliers.length
        });
    } catch (error) {
        console.error('Error fetching suppliers:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch suppliers',
            message: error.message
        });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const supplierId = parseInt(req.params.id);

        const [suppliers] = await db.execute(
            'SELECT supplierId, name, contactPerson, email, phone, address, notes, status, createdAt FROM suppliers WHERE supplierId = ?',
            [supplierId]
        );

        if (suppliers.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Supplier not found'
            });
        }

        res.json({
            success: true,
            data: suppliers[0]
        });
    } catch (error) {
        console.error('Error fetching supplier:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch supplier',
            message: error.message
        });
    }
});

router.post('/', async (req, res) => {
    try {
        const { name, contactPerson, email, phone, address, notes, status } = req.body;

        if (!name || !email) {
            return res.status(400).json({
                success: false,
                error: 'Name and email are required'
            });
        }

        const [existing] = await db.execute(
            'SELECT * FROM suppliers WHERE email = ?',
            [email.trim()]
        );

        if (existing.length > 0) {
            return res.status(400).json({
                success: false,
                error: 'Supplier with this email already exists'
            });
        }

        const notesVal = notes != null && String(notes).trim() ? String(notes).trim() : null;

        const [result] = await db.execute(
            `INSERT INTO suppliers (name, contactPerson, email, phone, address, notes, status)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                name.trim(),
                contactPerson ? contactPerson.trim() : null,
                email.trim(),
                phone ? phone.trim() : null,
                address ? address.trim() : null,
                notesVal,
                (status || 'active').toLowerCase()
            ]
        );

        const [newSupplier] = await db.execute(
            'SELECT supplierId, name, contactPerson, email, phone, address, notes, status, createdAt FROM suppliers WHERE supplierId = ?',
            [result.insertId]
        );

        res.status(201).json({
            success: true,
            message: 'Supplier added successfully',
            data: newSupplier[0]
        });
    } catch (error) {
        console.error('Error creating supplier:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create supplier',
            message: error.message
        });
    }
});

router.put('/:id', async (req, res) => {
    try {
        const supplierId = parseInt(req.params.id);
        const { name, contactPerson, email, phone, address, notes, status } = req.body;

        const [suppliers] = await db.execute(
            'SELECT * FROM suppliers WHERE supplierId = ?',
            [supplierId]
        );

        if (suppliers.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Supplier not found'
            });
        }

        if (email) {
            const [existing] = await db.execute(
                'SELECT * FROM suppliers WHERE email = ? AND supplierId != ?',
                [email.trim(), supplierId]
            );

            if (existing.length > 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Email already in use by another supplier'
                });
            }
        }

        const updates = [];
        const values = [];

        if (name !== undefined) {
            updates.push('name = ?');
            values.push(name.trim());
        }
        if (contactPerson !== undefined) {
            updates.push('contactPerson = ?');
            values.push(contactPerson ? contactPerson.trim() : null);
        }
        if (email !== undefined) {
            updates.push('email = ?');
            values.push(email.trim());
        }
        if (phone !== undefined) {
            updates.push('phone = ?');
            values.push(phone ? phone.trim() : null);
        }
        if (address !== undefined) {
            updates.push('address = ?');
            values.push(address ? address.trim() : null);
        }
        if (notes !== undefined) {
            updates.push('notes = ?');
            values.push(notes != null && String(notes).trim() ? String(notes).trim() : null);
        }
        if (status !== undefined) {
            updates.push('status = ?');
            values.push(status.toLowerCase());
        }

        if (updates.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No fields to update'
            });
        }

        values.push(supplierId);

        await db.execute(
            `UPDATE suppliers SET ${updates.join(', ')} WHERE supplierId = ?`,
            values
        );

        const [updatedSupplier] = await db.execute(
            'SELECT supplierId, name, contactPerson, email, phone, address, notes, status, createdAt FROM suppliers WHERE supplierId = ?',
            [supplierId]
        );

        res.json({
            success: true,
            message: 'Supplier updated successfully',
            data: updatedSupplier[0]
        });
    } catch (error) {
        console.error('Error updating supplier:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update supplier',
            message: error.message
        });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const supplierId = parseInt(req.params.id);

        const [suppliers] = await db.execute(
            'SELECT * FROM suppliers WHERE supplierId = ?',
            [supplierId]
        );

        if (suppliers.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Supplier not found'
            });
        }

        const pool = db;
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            await unlinkSupplierReferences(conn, supplierId);
            await conn.execute('DELETE FROM suppliers WHERE supplierId = ?', [supplierId]);
            await conn.commit();
        } catch (txErr) {
            try {
                await conn.rollback();
            } catch (rbErr) {
                console.error('[suppliers] rollback failed:', rbErr);
            }
            throw txErr;
        } finally {
            conn.release();
        }

        res.json({
            success: true,
            message: 'Supplier deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting supplier:', error);
        const msg = error.message || String(error);
        const isFk =
            error.code === 'ER_ROW_IS_REFERENCED_2' ||
            error.errno === 1451 ||
            /Cannot delete or update a parent row/i.test(msg);
        res.status(500).json({
            success: false,
            error: 'Failed to delete supplier',
            message: isFk
                ? 'This supplier is still referenced by data the server could not remove. Check server logs or contact support.'
                : msg
        });
    }
});

module.exports = router;
