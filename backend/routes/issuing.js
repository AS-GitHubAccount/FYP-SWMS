/**
 * Issuing API Routes (Out Records)
 * 
 * Handles stock issuing operations:
 * - POST /api/issuing - Issue stock and create out_record
 * - GET /api/issuing - Get all issuing records
 * - GET /api/issuing/:id - Get single issuing record
 */

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const pool = require('../config/database');
const getConnectionErrorMessage = db.getConnectionErrorMessage || (e => e && e.message);
const { generateRecordNumber } = require('../utils/idGenerator');
const { removeAlertsAndLog } = require('../utils/alertRemoval');

// Helper function to get batches using FEFO (First Expired First Out)
async function getBatchesForFEFO(productId, quantity, connection) {
    const [batches] = await connection.execute(`
        SELECT 
            b.*,
            p.name as productName,
            p.sku as productSku,
            COALESCE(SUM(or_out.quantity), 0) as reservedQty
        FROM batches b
        INNER JOIN products p ON b.productId = p.productId
        LEFT JOIN out_records or_out ON b.batchId = or_out.batchId
        WHERE b.productId = ?
            AND (b.expiryDate IS NULL OR b.expiryDate >= CURDATE())
            AND b.quantity > 0
        GROUP BY b.batchId
        HAVING (b.quantity - COALESCE(SUM(or_out.quantity), 0)) > 0
        ORDER BY 
            CASE WHEN b.expiryDate IS NULL THEN 1 ELSE 0 END,
            b.expiryDate ASC,
            b.receivedDate ASC
    `, [productId]);
    
    // Calculate available quantity for each batch
    const batchesWithAvailable = batches.map(batch => ({
        ...batch,
        available: batch.quantity - (batch.reservedQty || 0)
    }));
    
    // Allocate quantity using FEFO
    let remainingQty = quantity;
    const allocation = [];
    
    for (const batch of batchesWithAvailable) {
        if (remainingQty <= 0) break;
        
        const takeFromBatch = Math.min(remainingQty, batch.available);
        if (takeFromBatch > 0) {
            allocation.push({
                batchId: batch.batchId,
                lotCode: batch.lotCode,
                quantity: takeFromBatch,
                expiryDate: batch.expiryDate,
                available: batch.available
            });
            remainingQty -= takeFromBatch;
        }
    }
    
    return {
        allocation,
        canFulfill: remainingQty === 0,
        shortfall: remainingQty
    };
}

router.get('/', async (req, res) => {
    try {
        const [records] = await db.execute(`
            SELECT 
                or_out.*,
                p.name as productName,
                p.sku as productSku,
                b.lotCode,
                b.expiryDate,
                or_out.issuedBy as issuedByName
            FROM out_records or_out
            INNER JOIN products p ON or_out.productId = p.productId
            LEFT JOIN batches b ON or_out.batchId = b.batchId
            ORDER BY or_out.issuedDate DESC, or_out.recordId DESC
        `);
        
        res.json({
            success: true,
            count: records.length,
            data: records
        });
    } catch (error) {
        console.error('Error fetching issuing records:', error);
        const isDbError = error.code === 'ECONNREFUSED' || error.code === 'ER_ACCESS_DENIED_ERROR' || error.code === 'ER_BAD_DB_ERROR';
        const status = isDbError ? 503 : 500;
        res.status(status).json({ 
            success: false,
            error: isDbError ? (error.userMessage || getConnectionErrorMessage(error) || 'Unable to connect to the database. Please contact the administrator.') : 'Failed to fetch issuing records',
            message: error.message 
        });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const recordId = req.params.id;
        
        const [records] = await db.execute(`
            SELECT 
                or_out.*,
                p.name as productName,
                p.sku as productSku,
                b.lotCode,
                b.expiryDate,
                or_out.issuedBy as issuedByName
            FROM out_records or_out
            INNER JOIN products p ON or_out.productId = p.productId
            LEFT JOIN batches b ON or_out.batchId = b.batchId
            WHERE or_out.recordId = ?
        `, [recordId]);
        
        if (records.length === 0) {
            return res.status(404).json({ 
                success: false,
                error: 'Issuing record not found' 
            });
        }
        
        res.json({
            success: true,
            data: records[0]
        });
    } catch (error) {
        console.error('Error fetching issuing record:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to fetch issuing record',
            message: error.message 
        });
    }
});

router.post('/', async (req, res) => {
    const connection = await pool.getConnection();
    
    try {
        await connection.beginTransaction();
        
        const { 
            productId, 
            batchId,
            quantity, 
            recipient,
            issuedDate, 
            notes,
            issuedBy,
            bookingId,
            warehouseId
        } = req.body;
        
        // Validate required fields
        if (!productId || !quantity || quantity <= 0 || !recipient) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: productId, quantity (must be > 0), recipient'
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
        
        let finalBatchId = batchId;
        let fefoAllocation = null;
        
        // If batchId not provided, use FEFO to allocate
        if (!batchId) {
            const fefoResult = await getBatchesForFEFO(productId, quantity, connection);
            
            if (!fefoResult.canFulfill) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    error: `Insufficient stock. Available: ${quantity - fefoResult.shortfall}, Requested: ${quantity}`,
                    shortfall: fefoResult.shortfall
                });
            }
            
            // Use the first batch from FEFO allocation
            if (fefoResult.allocation.length > 0) {
                finalBatchId = fefoResult.allocation[0].batchId;
                fefoAllocation = fefoResult.allocation;
            }
        } else {
            // Validate batch exists, is not expired, and has enough stock
            const [batches] = await connection.execute(
                'SELECT * FROM batches WHERE batchId = ? AND productId = ?',
                [batchId, productId]
            );
            
            if (batches.length === 0) {
                await connection.rollback();
                return res.status(404).json({
                    success: false,
                    error: 'Batch not found or does not match product'
                });
            }
            
            const batch = batches[0];
            const [expiredCheck] = await connection.execute(
                'SELECT 1 FROM batches WHERE batchId = ? AND expiryDate IS NOT NULL AND expiryDate <= CURDATE()',
                [batchId]
            );
            if (expiredCheck.length > 0) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    error: 'Action Denied: Cannot issue expired stock. Please move to Disposal.',
                    code: 'EXPIRED_BATCH'
                });
            }
            
            // Check available quantity
            const [reservedData] = await connection.execute(`
                SELECT COALESCE(SUM(quantity), 0) as reserved
                FROM out_records
                WHERE batchId = ?
            `, [batchId]);
            
            const reserved = reservedData[0]?.reserved || 0;
            const available = batches[0].quantity - reserved;
            
            if (available < quantity) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    error: `Insufficient stock in batch. Available: ${available}, Requested: ${quantity}`
                });
            }
        }
        
        // Get user name if userId is provided
        let issuedByName = null;
        if (issuedBy) {
            const [users] = await connection.execute(
                'SELECT name FROM users WHERE userId = ?',
                [issuedBy]
            );
            issuedByName = users.length > 0 ? users[0].name : null;
        }
        
        // Create out_record (store name instead of ID)
        const recordNumber = await generateRecordNumber('OUT');
        const insertValuesWithoutWarehouse = [
            recordNumber,
            productId,
            finalBatchId,
            quantity,
            recipient,
            issuedByName, // Store name instead of ID
            issuedDate || new Date().toISOString().split('T')[0],
            notes || null
        ];

        let recordResult;
        try {
            // If the migration added `warehouseId`, store issued-from warehouse.
            if (warehouseId !== undefined) {
                let warehouseIdForDb = null;
                if (warehouseId !== null && warehouseId !== '') {
                    const wid = parseInt(warehouseId, 10);
                    if (!Number.isFinite(wid)) {
                        await connection.rollback();
                        return res.status(400).json({
                            success: false,
                            error: 'Invalid warehouseId'
                        });
                    }
                    warehouseIdForDb = wid;
                }
                const insertValuesWithWarehouse = [
                    ...insertValuesWithoutWarehouse,
                    warehouseIdForDb
                ];
                const [r] = await connection.execute(
                    `INSERT INTO out_records
                     (recordNumber, productId, batchId, quantity, recipient, issuedBy, issuedDate, notes, warehouseId)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    insertValuesWithWarehouse
                );
                recordResult = r;
            } else {
                const [r] = await connection.execute(
                    `INSERT INTO out_records
                     (recordNumber, productId, batchId, quantity, recipient, issuedBy, issuedDate, notes)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    insertValuesWithoutWarehouse
                );
                recordResult = r;
            }
        } catch (e) {
            // Safe fallback if `warehouseId` column doesn't exist yet.
            if (e && e.code === 'ER_BAD_FIELD_ERROR' && String(e.message || '').includes('warehouseId')) {
                const [r] = await connection.execute(
                    `INSERT INTO out_records
                     (recordNumber, productId, batchId, quantity, recipient, issuedBy, issuedDate, notes)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    insertValuesWithoutWarehouse
                );
                recordResult = r;
            } else {
                throw e;
            }
        }
        
        // Update inventory_items (decrease available, increase reserved)
        const [existingInventory] = await connection.execute(
            'SELECT * FROM inventory_items WHERE productId = ?',
            [productId]
        );
        
        if (existingInventory.length > 0) {
            await connection.execute(
                `UPDATE inventory_items 
                 SET available = available - ?,
                     reserved = reserved + ?
                 WHERE productId = ?`,
                [quantity, quantity, productId]
            );
        }
        
        // If linked to a booking, update booking status and store issuing record for traceability
        if (bookingId) {
            await connection.execute(
                `UPDATE bookings 
                 SET status = 'FULFILLED',
                     approvedDate = CURDATE(),
                     issuing_id = ?
                 WHERE bookingId = ?`,
                [recordResult.insertId, bookingId]
            );
        }
        
        await connection.commit();
        
        // Action-based alert removal: clear EXPIRED/NEAR_EXPIRY alerts for this batch
        await removeAlertsAndLog({ productId, batchId: finalBatchId, alertTypes: ['EXPIRED', 'NEAR_EXPIRY'] });
        
        // Fetch the created out_record with details
        const [newRecords] = await connection.execute(`
            SELECT 
                or_out.*,
                p.name as productName,
                p.sku as productSku,
                b.lotCode,
                b.expiryDate,
                or_out.issuedBy as issuedByName
            FROM out_records or_out
            INNER JOIN products p ON or_out.productId = p.productId
            LEFT JOIN batches b ON or_out.batchId = b.batchId
            WHERE or_out.recordId = ?
        `, [recordResult.insertId]);
        
        res.status(201).json({
            success: true,
            message: 'Stock issued successfully',
            data: {
                outRecord: newRecords[0],
                fefoAllocation: fefoAllocation
            }
        });
        
    } catch (error) {
        await connection.rollback();
        console.error('Error issuing stock:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to issue stock',
            message: error.message 
        });
    } finally {
        connection.release();
    }
});

router.get('/fefo/preview/:productId/:quantity', async (req, res) => {
    try {
        const productId = parseInt(req.params.productId);
        const quantity = parseInt(req.params.quantity);
        
        if (!productId || !quantity || quantity <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid productId or quantity'
            });
        }
        
        const connection = await pool.getConnection();
        const fefoResult = await getBatchesForFEFO(productId, quantity, connection);
        connection.release();
        
        res.json({
            success: true,
            data: fefoResult
        });
    } catch (error) {
        console.error('Error getting FEFO preview:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to get FEFO preview',
            message: error.message 
        });
    }
});

router.put('/:id', async (req, res) => {
    const connection = await pool.getConnection();
    
    try {
        const recordId = parseInt(req.params.id);
        const { quantity, recipient, issuedDate, notes, userId, userRole } = req.body;
        
        // Validate required fields
        if (!userId || !userRole) {
            return res.status(400).json({
                success: false,
                error: 'User ID and role are required'
            });
        }
        
        // Get the existing record
        const [records] = await connection.execute(
            'SELECT * FROM out_records WHERE recordId = ?',
            [recordId]
        );
        
        if (records.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Issuing record not found'
            });
        }
        
        const record = records[0];
        
        // Permission check: Admin can edit all, Staff can only edit their own
        const isAdmin = userRole.toUpperCase() === 'ADMIN';
        // Get current user name to check ownership
        const [currentUser] = await connection.execute(
            'SELECT name FROM users WHERE userId = ?',
            [userId]
        );
        const currentUserName = currentUser.length > 0 ? currentUser[0].name : null;
        const isOwner = record.issuedBy === currentUserName;
        
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
        
        if (recipient !== undefined) {
            updates.push('recipient = ?');
            values.push(recipient);
        }
        
        if (issuedDate !== undefined) {
            updates.push('issuedDate = ?');
            values.push(issuedDate);
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
        
        await connection.execute(
            `UPDATE out_records SET ${updates.join(', ')} WHERE recordId = ?`,
            values
        );
        
        // Fetch updated record with details
        const [updatedRecords] = await connection.execute(`
            SELECT 
                or_out.*,
                p.name as productName,
                p.sku as productSku,
                b.lotCode,
                b.expiryDate,
                or_out.issuedBy as issuedByName
            FROM out_records or_out
            INNER JOIN products p ON or_out.productId = p.productId
            LEFT JOIN batches b ON or_out.batchId = b.batchId
            WHERE or_out.recordId = ?
        `, [recordId]);
        
        res.json({
            success: true,
            message: 'Issuing record updated successfully',
            data: updatedRecords[0]
        });
        
    } catch (error) {
        console.error('Error updating issuing record:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to update issuing record',
            message: error.message 
        });
    } finally {
        connection.release();
    }
});

module.exports = router;

