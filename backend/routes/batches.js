/**
 * Batches API Routes
 * 
 * Handles batch-related endpoints:
 * - GET /api/batches - Get all batches
 * - GET /api/batches/product/:productId - Get batches for a specific product
 * - GET /api/batches/:id - Get single batch
 * - POST /api/batches - Create new batch
 * - PUT /api/batches/:id - Update batch
 * - DELETE /api/batches/:id - Delete batch
 */

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const getConnectionErrorMessage = db.getConnectionErrorMessage || ((e) => e && e.message);
const QRCode = require('qrcode');

// Helper function to calculate batch status and available quantity
function calculateBatchStatus(batch, reservedQuantity = 0) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expiryDate = batch.expiryDate ? new Date(batch.expiryDate) : null;
    
    let status = 'active';
    if (expiryDate) {
        expiryDate.setHours(0, 0, 0, 0);
        const daysUntilExpiry = Math.floor((expiryDate - today) / (1000 * 60 * 60 * 24));
        
        if (daysUntilExpiry < 0) {
            status = 'expired';
        } else if (daysUntilExpiry <= 7) {
            status = 'near_expiry';
        }
    }
    
    const available = Math.max(0, batch.quantity - reservedQuantity);
    
    return {
        status,
        available,
        quantityReserved: reservedQuantity
    };
}

// Helper function to format batch for frontend
function formatBatchForFrontend(batch, reservedQuantity = 0) {
    const calculated = calculateBatchStatus(batch, reservedQuantity);
    
    return {
        id: batch.batchId,
        batchId: batch.batchId,
        productId: batch.productId,
        lotCode: batch.lotCode,
        expiryDate: batch.expiryDate,
        quantityOnHand: batch.quantity,
        quantityReserved: calculated.quantityReserved,
        available: calculated.available,
        status: calculated.status,
        location: batch.location || 'N/A',
        notes: batch.notes || '',
        receivedDate: batch.receivedDate,
        supplier: batch.supplier || ''
    };
}

router.get('/', async (req, res) => {
    try {
        // Get all batches with product info
        const [batches] = await db.execute(`
            SELECT 
                b.*,
                p.name as productName,
                p.sku as productSku
            FROM batches b
            LEFT JOIN products p ON b.productId = p.productId
            ORDER BY b.expiryDate ASC, b.receivedDate DESC
        `);
        
        // Get reserved quantities from out_records (bookings/issuances)
        // This is a simplified calculation - in a real system, you'd track reserved quantities separately
        const [reservedData] = await db.execute(`
            SELECT 
                batchId,
                SUM(quantity) as reserved
            FROM out_records
            WHERE batchId IS NOT NULL
            GROUP BY batchId
        `);
        
        const reservedMap = {};
        reservedData.forEach(r => {
            reservedMap[r.batchId] = r.reserved || 0;
        });
        
        // Format batches for frontend
        const formattedBatches = batches.map(batch => {
            const reserved = reservedMap[batch.batchId] || 0;
            return formatBatchForFrontend(batch, reserved);
        });
        
        res.json({
            success: true,
            count: formattedBatches.length,
            data: formattedBatches
        });
    } catch (error) {
        console.error('Error fetching batches:', error);
        const isDbError =
            error.code === 'ECONNREFUSED' ||
            error.code === 'ENOTFOUND' ||
            error.code === 'EAI_AGAIN' ||
            error.code === 'ER_ACCESS_DENIED_ERROR' ||
            error.code === 'ER_BAD_DB_ERROR' ||
            error.code === 'ETIMEDOUT';
        const status = isDbError ? 503 : 500;
        res.status(status).json({
            success: false,
            error: isDbError
                ? (error.userMessage || getConnectionErrorMessage(error) || 'Unable to connect to the database.')
                : 'Failed to fetch batches',
            message: error.message || error.sqlMessage
        });
    }
});

router.get('/product/:productId', async (req, res) => {
    try {
        const productId = req.params.productId;
        
        // Get batches for this product
        const [batches] = await db.execute(`
            SELECT 
                b.*,
                p.name as productName,
                p.sku as productSku
            FROM batches b
            LEFT JOIN products p ON b.productId = p.productId
            WHERE b.productId = ?
            ORDER BY b.expiryDate ASC, b.receivedDate DESC
        `, [productId]);
        
        // Get reserved quantities for these batches
        if (batches.length > 0) {
            const batchIds = batches.map(b => b.batchId);
            const placeholders = batchIds.map(() => '?').join(',');
            
            const [reservedData] = await db.execute(`
                SELECT 
                    batchId,
                    SUM(quantity) as reserved
                FROM out_records
                WHERE batchId IN (${placeholders})
                GROUP BY batchId
            `, batchIds);
            
            const reservedMap = {};
            reservedData.forEach(r => {
                reservedMap[r.batchId] = r.reserved || 0;
            });
            
            // Format batches for frontend
            const formattedBatches = batches.map(batch => {
                const reserved = reservedMap[batch.batchId] || 0;
                return formatBatchForFrontend(batch, reserved);
            });
            
            res.json({
                success: true,
                count: formattedBatches.length,
                data: formattedBatches
            });
        } else {
            res.json({
                success: true,
                count: 0,
                data: []
            });
        }
    } catch (error) {
        console.error('Error fetching batches by product:', error);
        const isDbError =
            error.code === 'ECONNREFUSED' ||
            error.code === 'ENOTFOUND' ||
            error.code === 'EAI_AGAIN' ||
            error.code === 'ER_ACCESS_DENIED_ERROR' ||
            error.code === 'ER_BAD_DB_ERROR' ||
            error.code === 'ETIMEDOUT';
        const status = isDbError ? 503 : 500;
        res.status(status).json({
            success: false,
            error: isDbError
                ? (error.userMessage || getConnectionErrorMessage(error) || 'Unable to connect to the database.')
                : 'Failed to fetch batches',
            message: error.message || error.sqlMessage
        });
    }
});

// before GET /:id
router.get('/:id/qr', async (req, res) => {
    try {
        const rawId = req.params.id;
        const batchId = parseInt(rawId, 10);
        if (!batchId || isNaN(batchId)) {
            return res.status(400).json({ success: false, error: 'Invalid batch ID' });
        }
        const [rows] = await db.execute(`
            SELECT b.*, p.name AS productName, p.sku AS productSku
            FROM batches b
            INNER JOIN products p ON b.productId = p.productId
            WHERE b.batchId = ?
        `, [batchId]);
        if (!rows || rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Batch not found' });
        }
        const b = rows[0];
        const payload = {
            type: 'BATCH',
            batchId: String(b.batchId),
            productId: String(b.productId),
            sku: b.productSku || '',
            name: (b.productName || '').slice(0, 80),
            lotCode: b.lotCode || '',
            expiryDate: b.expiryDate ? String(b.expiryDate).slice(0, 10) : null
        };
        const jsonStr = JSON.stringify(payload);
        const dataUrl = await QRCode.toDataURL(jsonStr, { type: 'image/png', margin: 1, width: 200, color: { dark: '#0f172a', light: '#ffffff' } });
        if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) {
            return res.status(500).json({ success: false, error: 'QR generation failed' });
        }
        res.json({ success: true, dataUrl, payload });
    } catch (err) {
        console.error('Error generating batch QR:', err);
        res.status(500).json({ success: false, error: err.message || 'QR generation failed' });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const batchId = req.params.id;
        
        // Get batch
        const [batches] = await db.execute(`
            SELECT 
                b.*,
                p.name as productName,
                p.sku as productSku
            FROM batches b
            LEFT JOIN products p ON b.productId = p.productId
            WHERE b.batchId = ?
        `, [batchId]);
        
        if (batches.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Batch not found'
            });
        }
        
        // Get reserved quantity
        const [reservedData] = await db.execute(`
            SELECT SUM(quantity) as reserved
            FROM out_records
            WHERE batchId = ?
        `, [batchId]);
        
        const reserved = reservedData[0]?.reserved || 0;
        const formattedBatch = formatBatchForFrontend(batches[0], reserved);
        
        res.json({
            success: true,
            data: formattedBatch
        });
    } catch (error) {
        console.error('Error fetching batch:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to fetch batch',
            message: error.message 
        });
    }
});

router.post('/', async (req, res) => {
    try {
        const { productId, lotCode, quantity, expiryDate, receivedDate, supplier, location, notes } = req.body;
        
        // Validate required fields
        if (!productId || !lotCode || !quantity) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: productId, lotCode, quantity'
            });
        }
        
        // Check if lot code already exists
        const [existing] = await db.execute(
            'SELECT batchId FROM batches WHERE lotCode = ?',
            [lotCode]
        );
        
        if (existing.length > 0) {
            return res.status(400).json({
                success: false,
                error: 'Lot code already exists'
            });
        }
        
        // Insert batch
        const [result] = await db.execute(`
            INSERT INTO batches (productId, lotCode, quantity, expiryDate, receivedDate, supplier, location, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [productId, lotCode, quantity, expiryDate || null, receivedDate || new Date().toISOString().split('T')[0], supplier || null, location || null, notes || null]);
        
        // Get the created batch
        const [batches] = await db.execute(
            'SELECT * FROM batches WHERE batchId = ?',
            [result.insertId]
        );
        
        const formattedBatch = formatBatchForFrontend(batches[0], 0);
        
        res.status(201).json({
            success: true,
            data: formattedBatch
        });
    } catch (error) {
        console.error('Error creating batch:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to create batch',
            message: error.message 
        });
    }
});

router.put('/:id', async (req, res) => {
    try {
        const batchId = req.params.id;
        const { lotCode, quantity, expiryDate, receivedDate, supplier, location, notes, lastMaintenanceDate, nextMaintenanceDue, installationDate, warrantyExpiry } = req.body;
        
        // Check if batch exists
        const [existing] = await db.execute(
            'SELECT * FROM batches WHERE batchId = ?',
            [batchId]
        );
        
        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Batch not found'
            });
        }
        
        // Check if lot code is being changed and if new lot code already exists
        if (lotCode && lotCode !== existing[0].lotCode) {
            const [duplicate] = await db.execute(
                'SELECT batchId FROM batches WHERE lotCode = ? AND batchId != ?',
                [lotCode, batchId]
            );
            
            if (duplicate.length > 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Lot code already exists'
                });
            }
        }
        
        await db.execute(`
            UPDATE batches 
            SET lotCode = COALESCE(?, lotCode),
                quantity = COALESCE(?, quantity),
                expiryDate = ?,
                receivedDate = COALESCE(?, receivedDate),
                supplier = COALESCE(?, supplier),
                location = COALESCE(?, location),
                notes = COALESCE(?, notes),
                lastMaintenanceDate = COALESCE(?, lastMaintenanceDate),
                nextMaintenanceDue = COALESCE(?, nextMaintenanceDue)
            WHERE batchId = ?
        `, [lotCode, quantity, expiryDate || null, receivedDate, supplier, location, notes, lastMaintenanceDate || null, nextMaintenanceDue || null, batchId]);
        
        // Get updated batch
        const [batches] = await db.execute(
            'SELECT * FROM batches WHERE batchId = ?',
            [batchId]
        );
        
        // Get reserved quantity
        const [reservedData] = await db.execute(`
            SELECT SUM(quantity) as reserved
            FROM out_records
            WHERE batchId = ?
        `, [batchId]);
        
        const reserved = reservedData[0]?.reserved || 0;
        const formattedBatch = formatBatchForFrontend(batches[0], reserved);
        
        res.json({
            success: true,
            data: formattedBatch
        });
    } catch (error) {
        console.error('Error updating batch:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to update batch',
            message: error.message 
        });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const batchId = req.params.id;
        
        // Check if batch exists
        const [existing] = await db.execute(
            'SELECT * FROM batches WHERE batchId = ?',
            [batchId]
        );
        
        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Batch not found'
            });
        }
        
        // Check if batch has been used in out_records
        const [used] = await db.execute(
            'SELECT COUNT(*) as count FROM out_records WHERE batchId = ?',
            [batchId]
        );
        
        if (used[0].count > 0) {
            return res.status(400).json({
                success: false,
                error: 'Cannot delete batch that has been used in transactions'
            });
        }
        
        // Delete batch
        await db.execute(
            'DELETE FROM batches WHERE batchId = ?',
            [batchId]
        );
        
        res.json({
            success: true,
            message: 'Batch deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting batch:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to delete batch',
            message: error.message 
        });
    }
});

module.exports = router;

