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

// ============================================
// GET ALL SUPPLIERS
// ============================================
router.get('/', async (req, res) => {
    try {
        const [suppliers] = await db.execute(
            'SELECT supplierId, name, contactPerson, email, phone, address, status, createdAt FROM suppliers ORDER BY name ASC'
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

// ============================================
// GET SUPPLIER BY ID
// ============================================
router.get('/:id', async (req, res) => {
    try {
        const supplierId = parseInt(req.params.id);

        const [suppliers] = await db.execute(
            'SELECT supplierId, name, contactPerson, email, phone, address, status, createdAt FROM suppliers WHERE supplierId = ?',
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

// ============================================
// CREATE NEW SUPPLIER
// ============================================
router.post('/', async (req, res) => {
    try {
        const { name, contactPerson, email, phone, address, status } = req.body;

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

        const [result] = await db.execute(
            `INSERT INTO suppliers (name, contactPerson, email, phone, address, status)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                name.trim(),
                contactPerson ? contactPerson.trim() : null,
                email.trim(),
                phone ? phone.trim() : null,
                address ? address.trim() : null,
                (status || 'active').toLowerCase()
            ]
        );

        const [newSupplier] = await db.execute(
            'SELECT supplierId, name, contactPerson, email, phone, address, status, createdAt FROM suppliers WHERE supplierId = ?',
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

// ============================================
// UPDATE SUPPLIER
// ============================================
router.put('/:id', async (req, res) => {
    try {
        const supplierId = parseInt(req.params.id);
        const { name, contactPerson, email, phone, address, status } = req.body;

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
            'SELECT supplierId, name, contactPerson, email, phone, address, status, createdAt FROM suppliers WHERE supplierId = ?',
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

// ============================================
// DELETE SUPPLIER
// ============================================
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

        await db.execute('DELETE FROM suppliers WHERE supplierId = ?', [supplierId]);

        res.json({
            success: true,
            message: 'Supplier deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting supplier:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete supplier',
            message: error.message
        });
    }
});

module.exports = router;
