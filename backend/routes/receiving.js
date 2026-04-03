/**
 * Receiving API Routes
 * 
 * Handles stock receiving operations:
 * - POST /api/receiving - Receive stock and create batch + in_record
 * - GET /api/receiving - Get all receiving records
 * - GET /api/receiving/:id - Get single receiving record
 */

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const pool = require('../config/database');
const getConnectionErrorMessage = db.getConnectionErrorMessage || (e => e && e.message);
const { logAudit, getClientIp, getUserAgent } = require('../utils/auditLogger');
const { generateRecordNumber } = require('../utils/idGenerator');

// ============================================
// GET ALL RECEIVING RECORDS
// ============================================
router.get('/', async (req, res) => {
    try {
        const [records] = await db.execute(`
            SELECT 
                ir.*,
                p.name as productName,
                p.sku as productSku,
                b.lotCode,
                b.expiryDate,
                ir.receivedBy as receivedByName
            FROM in_records ir
            INNER JOIN products p ON ir.productId = p.productId
            LEFT JOIN batches b ON ir.batchId = b.batchId
            ORDER BY ir.receivedDate DESC, ir.recordId DESC
        `);
        
        res.json({
            success: true,
            count: records.length,
            data: records
        });
    } catch (error) {
        console.error('Error fetching receiving records:', error);
        const isDbError = error.code === 'ECONNREFUSED' || error.code === 'ER_ACCESS_DENIED_ERROR' || error.code === 'ER_BAD_DB_ERROR';
        const status = isDbError ? 503 : 500;
        res.status(status).json({ 
            success: false,
            error: isDbError ? (error.userMessage || getConnectionErrorMessage(error) || 'Unable to connect to the database. Please contact the administrator.') : 'Failed to fetch receiving records',
            message: error.message 
        });
    }
});

// ============================================
// GET SINGLE RECEIVING RECORD
// ============================================
router.get('/:id', async (req, res) => {
    try {
        const recordId = req.params.id;
        
        const [records] = await db.execute(`
            SELECT 
                ir.*,
                p.name as productName,
                p.sku as productSku,
                b.lotCode,
                b.expiryDate,
                ir.receivedBy as receivedByName
            FROM in_records ir
            INNER JOIN products p ON ir.productId = p.productId
            LEFT JOIN batches b ON ir.batchId = b.batchId
            WHERE ir.recordId = ?
        `, [recordId]);
        
        if (records.length === 0) {
            return res.status(404).json({ 
                success: false,
                error: 'Receiving record not found' 
            });
        }
        
        res.json({
            success: true,
            data: records[0]
        });
    } catch (error) {
        console.error('Error fetching receiving record:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to fetch receiving record',
            message: error.message 
        });
    }
});

// ============================================
// RECEIVE STOCK (Create Batch + In Record)
// ============================================
router.post('/', async (req, res) => {
    const connection = await pool.getConnection();
    
    try {
        await connection.beginTransaction();
        
        const { 
            productId, 
            lotCode, 
            quantity, 
            expiryDate, 
            receivedDate, 
            supplier, 
            location, 
            notes,
            receivedBy 
        } = req.body;
        
        // Validate required fields
        if (!productId || !lotCode || !quantity || quantity <= 0) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: productId, lotCode, quantity (must be > 0)'
            });
        }
        
        // Check if product exists
        const [products] = await connection.execute(
            'SELECT * FROM products WHERE productId = ?',
            [productId]
        );
        
        if (products.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                error: 'Product not found'
            });
        }
        
        // Check if batch with same lot code exists
        const [existingBatches] = await connection.execute(
            'SELECT * FROM batches WHERE lotCode = ?',
            [lotCode]
        );
        
        let batchId;
        
        if (existingBatches.length > 0) {
            // Update existing batch - add to quantity
            batchId = existingBatches[0].batchId;
            const newQuantity = existingBatches[0].quantity + quantity;
            
            await connection.execute(
                `UPDATE batches 
                 SET quantity = ?,
                     expiryDate = COALESCE(?, expiryDate),
                     supplier = COALESCE(?, supplier),
                     location = COALESCE(?, location),
                     notes = COALESCE(?, notes)
                 WHERE batchId = ?`,
                [newQuantity, expiryDate || null, supplier || null, location || null, notes || null, batchId]
            );
        } else {
            // Create new batch
            const [batchResult] = await connection.execute(
                `INSERT INTO batches 
                 (productId, lotCode, quantity, expiryDate, receivedDate, supplier, location, notes)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    productId,
                    lotCode,
                    quantity,
                    expiryDate || null,
                    receivedDate || new Date().toISOString().split('T')[0],
                    supplier || null,
                    location || null,
                    notes || null
                ]
            );
            
            batchId = batchResult.insertId;
        }
        
        // Get user name if userId is provided
        let receivedByName = null;
        if (receivedBy) {
            const [users] = await connection.execute(
                'SELECT name FROM users WHERE userId = ?',
                [receivedBy]
            );
            receivedByName = users.length > 0 ? users[0].name : null;
        }
        
        // Create in_record linked to batch (store name instead of ID)
        const recordNumber = await generateRecordNumber('IN');
        const [recordResult] = await connection.execute(
            `INSERT INTO in_records 
             (recordNumber, productId, batchId, quantity, supplier, receivedBy, receivedDate, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                recordNumber,
                productId,
                batchId,
                quantity,
                supplier || null,
                receivedByName, // Store name instead of ID
                receivedDate || new Date().toISOString().split('T')[0],
                notes || null
            ]
        );
        
        // Update or create inventory_items
        const [existingInventory] = await connection.execute(
            'SELECT * FROM inventory_items WHERE productId = ?',
            [productId]
        );
        
        if (existingInventory.length > 0) {
            // Update existing inventory
            await connection.execute(
                `UPDATE inventory_items 
                 SET totalQty = totalQty + ?,
                     available = available + ?,
                     location = COALESCE(?, location)
                 WHERE productId = ?`,
                [quantity, quantity, location || null, productId]
            );
        } else {
            // Create new inventory item
            await connection.execute(
                `INSERT INTO inventory_items (productId, totalQty, available, reserved, location)
                 VALUES (?, ?, ?, 0, ?)`,
                [productId, quantity, quantity, location || null]
            );
        }
        
        await connection.commit();
        
        // Get user name for audit log
        const [users] = await connection.execute(
            'SELECT name FROM users WHERE userId = ?',
            [receivedBy || 0]
        );
        const userName = users.length > 0 ? users[0].name : null;
        
        // Log the creation to audit_log
        await logAudit({
            tableName: 'in_records',
            recordId: recordResult.insertId,
            action: 'INSERT',
            userId: receivedBy || null,
            userName: userName,
            oldValues: null,
            newValues: {
                recordNumber: recordNumber,
                productId: productId,
                batchId: batchId,
                quantity: quantity,
                supplier: supplier,
                receivedDate: receivedDate || new Date().toISOString().split('T')[0],
                notes: notes
            },
            ipAddress: getClientIp(req),
            userAgent: getUserAgent(req)
        });
        
        // Fetch the created in_record with details
        const [newRecords] = await connection.execute(`
            SELECT 
                ir.*,
                p.name as productName,
                p.sku as productSku,
                b.lotCode,
                b.expiryDate,
                ir.receivedBy as receivedByName
            FROM in_records ir
            INNER JOIN products p ON ir.productId = p.productId
            LEFT JOIN batches b ON ir.batchId = b.batchId
            WHERE ir.recordId = ?
        `, [recordResult.insertId]);
        
        res.status(201).json({
            success: true,
            message: 'Stock received successfully',
            data: {
                inRecord: newRecords[0],
                batchId: batchId,
                batchUpdated: existingBatches.length > 0
            }
        });
        
    } catch (error) {
        await connection.rollback();
        console.error('Error receiving stock:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to receive stock',
            message: error.message 
        });
    } finally {
        connection.release();
    }
});

// ============================================
// UPDATE RECEIVING RECORD
// ============================================
router.put('/:id', async (req, res) => {
    const connection = await pool.getConnection();
    
    try {
        const recordId = parseInt(req.params.id);
        const { quantity, supplier, receivedDate, notes, userId, userRole } = req.body;
        
        // Validate required fields
        if (!userId || !userRole) {
            return res.status(400).json({
                success: false,
                error: 'User ID and role are required'
            });
        }
        
        // Get the existing record
        const [records] = await connection.execute(
            'SELECT * FROM in_records WHERE recordId = ?',
            [recordId]
        );
        
        if (records.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Receiving record not found'
            });
        }
        
        const record = records[0];
        
        // Permission check: Admin can edit all, Staff can only edit their own
        const isAdmin = userRole.toUpperCase() === 'ADMIN';
        // Get current user name to check ownership (receivedBy now stores name, not ID)
        const [currentUser] = await connection.execute(
            'SELECT name FROM users WHERE userId = ?',
            [userId]
        );
        const currentUserName = currentUser.length > 0 ? currentUser[0].name : null;
        const isOwner = record.receivedBy === currentUserName;
        
        if (!isAdmin && !isOwner) {
            return res.status(403).json({
                success: false,
                error: 'You do not have permission to edit this record'
            });
        }
        
        // Build update query dynamically
        const updates = [];
        const values = [];
        
        if (quantity !== undefined) {
            if (quantity <= 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Quantity must be greater than 0'
                });
            }
            updates.push('quantity = ?');
            values.push(quantity);
        }
        
        if (supplier !== undefined) {
            updates.push('supplier = ?');
            values.push(supplier);
        }
        
        if (receivedDate !== undefined) {
            updates.push('receivedDate = ?');
            values.push(receivedDate);
        }
        
        if (notes !== undefined) {
            updates.push('notes = ?');
            values.push(notes);
        }
        
        if (updates.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No fields to update'
            });
        }
        
        values.push(recordId);
        
        // Get user name for audit log and update
        const [users] = await connection.execute(
            'SELECT name FROM users WHERE userId = ?',
            [userId]
        );
        const userName = users.length > 0 ? users[0].name : null;
        
        // If receivedBy should be updated, get the name
        // Note: receivedBy now stores the name, not the ID
        // We'll update it to the current user's name if they're editing
        if (userName) {
            updates.push('receivedBy = ?');
            values.splice(values.length - 1, 0, userName); // Insert before recordId
        }
        
        // Prepare old and new values for audit log
        const oldValues = {
            quantity: record.quantity,
            supplier: record.supplier,
            receivedDate: record.receivedDate,
            notes: record.notes,
            receivedBy: record.receivedBy
        };
        
        const newValues = {
            quantity: quantity !== undefined ? quantity : record.quantity,
            supplier: supplier !== undefined ? supplier : record.supplier,
            receivedDate: receivedDate !== undefined ? receivedDate : record.receivedDate,
            notes: notes !== undefined ? notes : record.notes,
            receivedBy: userName || record.receivedBy
        };
        
        await connection.execute(
            `UPDATE in_records SET ${updates.join(', ')} WHERE recordId = ?`,
            values
        );
        
        // Log the change to audit_log
        await logAudit({
            tableName: 'in_records',
            recordId: recordId,
            action: 'UPDATE',
            userId: parseInt(userId),
            userName: userName,
            oldValues: oldValues,
            newValues: newValues,
            ipAddress: getClientIp(req),
            userAgent: getUserAgent(req)
        });
        
        // Fetch updated record with details
        const [updatedRecords] = await connection.execute(`
            SELECT 
                ir.*,
                p.name as productName,
                p.sku as productSku,
                b.lotCode,
                b.expiryDate,
                ir.receivedBy as receivedByName
            FROM in_records ir
            INNER JOIN products p ON ir.productId = p.productId
            LEFT JOIN batches b ON ir.batchId = b.batchId
            WHERE ir.recordId = ?
        `, [recordId]);
        
        res.json({
            success: true,
            message: 'Receiving record updated successfully',
            data: updatedRecords[0]
        });
        
    } catch (error) {
        console.error('Error updating receiving record:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to update receiving record',
            message: error.message 
        });
    } finally {
        connection.release();
    }
});

module.exports = router;

