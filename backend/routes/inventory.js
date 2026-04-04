// /api/inventory
const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const db = require('../config/database');
const pool = require('../config/database');
const { notifyAdmins, notifyUser } = require('../utils/notificationHelper');
const { checkAndCreateAlerts } = require('../utils/alertChecker');
const { generateBookingNumber, generateRecordNumber } = require('../utils/idGenerator');

function resolvedDbLabel() {
    try {
        return typeof db.getResolvedDatabaseName === 'function'
            ? db.getResolvedDatabaseName()
            : (process.env.DB_NAME || 'swms_db');
    } catch (e) {
        return process.env.DB_NAME || 'swms_db';
    }
}

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
    
    const batchesWithAvailable = batches.map(batch => ({
        ...batch,
        available: batch.quantity - (batch.reservedQty || 0)
    }));
    
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
        const [inventory] = await db.execute(`
            SELECT 
                p.productId,
                COALESCE(i.inventoryId, 0) AS inventoryId,
                COALESCE(i.totalQty, 0) AS totalQty,
                COALESCE(i.available, 0) AS available,
                COALESCE(i.reserved, 0) AS reserved,
                i.location,
                p.sku,
                p.name,
                p.category,
                p.unit,
                p.minStock,
                p.productType,
                p.warrantyMonths,
                p.maintenanceIntervalMonths
            FROM products p
            LEFT JOIN inventory_items i ON i.productId = p.productId
            ORDER BY p.name
        `);

        let validQtyMap = {};
        try {
            const [batchQty] = await db.execute(`
                SELECT b.productId,
                    COALESCE(SUM(CASE WHEN b.expiryDate IS NULL OR b.expiryDate > CURDATE() THEN b.quantity ELSE 0 END), 0) as validQty
                FROM batches b
                GROUP BY b.productId
            `);
            (batchQty || []).forEach(r => { validQtyMap[r.productId] = Number(r.validQty) || 0; });
        } catch (batchErr) {
            console.warn('Batches query failed (non-fatal):', batchErr.message);
        }

        /** Products with approved bookings not yet released (no issuing record linked). */
        let placingOrderProductIds = new Set();
        try {
            const [poRows] = await db.execute(`
                SELECT DISTINCT b.productId
                FROM bookings b
                WHERE b.status = 'APPROVED'
                  AND (b.issuing_id IS NULL OR b.issuing_id = 0)
            `);
            (poRows || []).forEach(r => {
                if (r.productId != null) placingOrderProductIds.add(Number(r.productId));
            });
        } catch (poErr) {
            if (poErr.code === 'ER_BAD_FIELD_ERROR') {
                try {
                    const [poRows2] = await db.execute(`
                        SELECT DISTINCT productId FROM bookings WHERE status = 'APPROVED'
                    `);
                    (poRows2 || []).forEach(r => {
                        if (r.productId != null) placingOrderProductIds.add(Number(r.productId));
                    });
                } catch (_) { /* ignore */ }
            } else {
                console.warn('Placing-order bookings query failed (non-fatal):', poErr.message);
            }
        }

        const enriched = inventory.map(item => {
            const validQty = validQtyMap[item.productId] ?? 0;
            const total = Number(item.totalQty) || 0;
            const minStock = Number(item.minStock) || 0;
            let statusLabel, status;
            if (total === 0) {
                statusLabel = 'Out of Stock';
                status = 'out_of_stock';
            } else if (validQty === 0) {
                statusLabel = 'Expired';
                status = 'expired';
            } else if (validQty > 0 && placingOrderProductIds.has(Number(item.productId))) {
                statusLabel = 'Placing order';
                status = 'placing_order';
            } else if (validQty <= minStock) {
                statusLabel = 'Low Stock';
                status = 'low_stock';
            } else {
                statusLabel = 'OK';
                status = 'ok';
            }
            item.nonExpiredQty = validQty;
            item.validQty = validQty;
            item.status = status;
            item.statusLabel = statusLabel;
            return item;
        });
        
        res.json({
            success: true,
            count: enriched.length,
            data: enriched
        });
    } catch (error) {
        console.error('Error fetching inventory:', error);
        if (error.code === 'ER_NO_SUCH_TABLE') {
            return res.json({ success: true, count: 0, data: [] });
        }
        // Prototype safety: return an empty list instead of a 500 so the frontend never gets "stuck".
        return res.json({
            success: false,
            count: 0,
            data: [],
            error: 'Failed to fetch inventory',
            message: error.message
        });
    }
});

// reorder suggestions
router.get('/reorder-suggestions', async (req, res) => {
    try {
        const [rows] = await db.execute(`
            SELECT i.productId, p.sku, p.name, p.unit, p.minStock, i.available,
                   GREATEST(0, p.minStock - i.available) as suggestedQty
            FROM inventory_items i
            INNER JOIN products p ON i.productId = p.productId
            WHERE p.minStock > 0 AND i.available < p.minStock
            ORDER BY (p.minStock - i.available) DESC
        `);
        res.json({ success: true, count: rows.length, data: rows });
    } catch (err) {
        console.error('Error fetching reorder suggestions:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET SINGLE INVENTORY ITEM
router.get('/items/:id', async (req, res) => {
    try {
        const inventoryId = req.params.id;
        
        const [items] = await db.execute(`
            SELECT 
                i.*,
                p.sku,
                p.name,
                p.category,
                p.unit,
                p.minStock
            FROM inventory_items i
            INNER JOIN products p ON i.productId = p.productId
            WHERE i.inventoryId = ?
        `, [inventoryId]);
        
        if (items.length === 0) {
            return res.status(404).json({ 
                success: false,
                error: 'Inventory item not found' 
            });
        }
        
        res.json({
            success: true,
            data: items[0]
        });
    } catch (error) {
        console.error('Error fetching inventory item:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to fetch inventory item',
            message: error.message 
        });
    }
});


// GET batch QR code (fallback when /api/batches/:id/qr is unreachable)
router.get('/batches/:id/qr', async (req, res) => {
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
        console.error('Error generating batch QR (inventory fallback):', err);
        res.status(500).json({ success: false, error: err.message || 'QR generation failed' });
    }
});

// GET batch-level details for a specific batch (used by QR / batch passport)
router.get('/batch-details/:batchId', async (req, res) => {
    try {
        const batchId = req.params.batchId;
        const [rows] = await db.execute(`
            SELECT 
                b.*,
                p.name AS productName,
                p.sku AS productSku
            FROM batches b
            INNER JOIN products p ON b.productId = p.productId
            WHERE b.batchId = ?
        `, [batchId]);

        if (!rows || rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Batch not found'
            });
        }

        const batch = rows[0];
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        let statusStage = 'IN_STORAGE';
        let statusLabel = 'In Storage';
        if (batch.expiryDate) {
            const exp = new Date(batch.expiryDate);
            exp.setHours(0, 0, 0, 0);
            const daysUntilExpiry = Math.floor((exp - today) / (1000 * 60 * 60 * 24));
            if (daysUntilExpiry < 0) {
                statusStage = 'EXPIRED';
                statusLabel = 'Expired';
            } else if (daysUntilExpiry <= 7) {
                statusStage = 'IN_STORAGE';
                statusLabel = 'Near Expiry';
            }
        }

        return res.json({
            success: true,
            data: {
                productName: batch.productName,
                productId: batch.productId,
                sku: batch.productSku,
                batchId: batch.batchId,
                lotCode: batch.lotCode,
                expiryDate: batch.expiryDate,
                quantityOnHand: batch.quantity,
                location: batch.location || null,
                status: {
                    stage: statusStage,
                    label: statusLabel
                }
            }
        });
    } catch (err) {
        console.error('Error fetching batch details:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch batch details',
            message: err.message
        });
    }
});

// QR SCAN endpoint: accepts encoded payload (product-level or batch-level)
// Supports: JSON {type:'BATCH', batchId}, JSON {type:'INV_ITEM', id}, or human-readable "SKU\nLOT\nName"
// Also supports POST /scan with body { payload: "..." } to avoid URL encoding issues
function parseScanPayload(text) {
    if (!text || typeof text !== 'string') return null;
    const textTrimmed = text.trim();
    const lines = textTrimmed.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
    function extractSku() {
        // Format: BATCH:LOT\nSKU\nLOT\nName -> SKU is lines[1]
        if (lines.length >= 2) {
            const first = lines[0];
            const second = lines[1];
            if (first.startsWith('BATCH:')) return second || null;
            if (!second.match(/^LOT[-A-Z0-9_]+$/i)) return second; // line 2 is SKU if not a lot code
        }
        return null;
    }
    try {
        const parsed = JSON.parse(textTrimmed);
        if (parsed && typeof parsed === 'object') {
            if (!parsed.sku && extractSku()) parsed.sku = extractSku();
            return parsed;
        }
    } catch (e) { /* not JSON */ }
    // BATCH:LOT-xxx or BATCH:LOT-xxx:batchId format (scanner-safe)
    const batchMatch = textTrimmed.match(/BATCH:([^\s\r\n:]+)(?::(\d+))?/);
    if (batchMatch) {
        const lotCode = batchMatch[1].trim();
        const batchId = batchMatch[2] ? parseInt(batchMatch[2], 10) : null;
        if (lotCode || batchId) {
            const out = { type: 'BATCH', lotCode: lotCode || null, batchId };
            const sku = extractSku();
            if (sku) out.sku = sku;
            return out;
        }
    }
    // Human-readable format: SKU\nLOT-xxx\nProduct Name (or BATCH:LOT\nSKU\nLOT\nName)
    if (lines.length >= 2) {
        const first = lines[0];
        if (first.startsWith('BATCH:')) {
            const lotStr = first.slice(6).trim();
            if (lotStr) {
                const out = { type: 'BATCH', lotCode: lotStr };
                if (extractSku()) out.sku = extractSku();
                return out;
            }
        }
        const out = { type: 'BATCH', lotCode: lines[1] };
        if (lines[0] && !lines[0].match(/^LOT[-A-Z0-9_]+$/i)) out.sku = lines[0];
        return out;
    }
    // Single line: try to extract lot code (LOT-xxx, SEED-LOT-xxx, etc.)
    const lotMatch = textTrimmed.match(/\b([A-Z0-9_-]*LOT[-A-Z0-9_]+)\b/i);
    if (lotMatch) {
        return { type: 'BATCH', lotCode: lotMatch[1] };
    }
    return { type: 'INV_ITEM', id: textTrimmed };
}

router.get('/scan/:payload', async (req, res) => {
    let text;
    try {
        text = decodeURIComponent(req.params.payload);
    } catch (e) {
        return res.status(400).json({ success: false, error: 'Invalid QR payload encoding' });
    }
    const decoded = parseScanPayload(text);
    if (!decoded) return res.status(400).json({ success: false, error: 'Invalid QR payload' });
    return handleScanRequest(decoded, res);
});

router.post('/scan', async (req, res) => {
    const text = req.body && req.body.payload ? String(req.body.payload) : '';
    const decoded = parseScanPayload(text);
    if (!decoded) return res.status(400).json({ success: false, error: 'Invalid QR payload' });
    return handleScanRequest(decoded, res);
});

async function handleScanRequest(decoded, res) {
    const type = (decoded.type || '').toUpperCase();

    try {
        if (type === 'BATCH') {
            let batchId = decoded.batchId;
            const lotCode = decoded.lotCode;
            const validLotCode = lotCode && lotCode !== '-' && String(lotCode).trim().length > 0;
            const sku = decoded.sku;

            // Prefer lotCode over batchId: lotCode is authoritative (batchId from fallback may be wrong)
            if (validLotCode) {
                const [lotRows] = await db.execute(
                    'SELECT batchId FROM batches WHERE lotCode = ? LIMIT 1',
                    [lotCode.trim()]
                );
                if (lotRows && lotRows.length > 0) {
                    batchId = lotRows[0].batchId;
                }
            }

            // Fallback to batchId only when lotCode lookup failed or was absent
            if (!batchId && decoded.batchId && !isNaN(decoded.batchId)) {
                batchId = decoded.batchId;
            }

            if (!batchId) {
                // SKU fallback: batch not found, try product by SKU and return first batch
                if (sku && String(sku).trim()) {
                    const [prodRows] = await db.execute(
                        'SELECT productId, sku, name FROM products WHERE sku = ? LIMIT 1',
                        [sku.trim()]
                    );
                    if (prodRows && prodRows.length > 0) {
                        const product = prodRows[0];
                        const [batchRows] = await db.execute(
                            `SELECT b.*, p.name AS productName, p.sku AS productSku
                             FROM batches b INNER JOIN products p ON b.productId = p.productId
                             WHERE b.productId = ? AND b.quantity > 0
                             ORDER BY b.expiryDate IS NULL, b.expiryDate ASC LIMIT 1`,
                            [product.productId]
                        );
                        if (batchRows && batchRows.length > 0) {
                            const batch = batchRows[0];
                            const today = new Date();
                            today.setHours(0, 0, 0, 0);
                            let stage = 'IN_STORAGE';
                            let label = 'In Storage';
                            let expiryDateText = '—';
                            if (batch.expiryDate) {
                                const exp = new Date(batch.expiryDate);
                                exp.setHours(0, 0, 0, 0);
                                const daysUntilExpiry = Math.floor((exp - today) / (1000 * 60 * 60 * 24));
                                expiryDateText = exp.toISOString().slice(0, 10);
                                if (daysUntilExpiry < 0) {
                                    stage = 'EXPIRED';
                                    label = 'Expired';
                                } else if (daysUntilExpiry <= 7) {
                                    label = 'Near Expiry';
                                }
                            }
                            return res.json({
                                success: true,
                                data: {
                                    product: { productId: product.productId, name: product.name, sku: product.sku },
                                    productId: product.productId,
                                    batchId: batch.batchId,
                                    locationText: batch.location || 'N/A',
                                    status: { stage, label },
                                    timeline: {
                                        receivedDate: batch.receivedDate ? new Date(batch.receivedDate).toISOString().slice(0, 10) : '—',
                                        expiryDate: expiryDateText
                                    },
                                    history: {
                                        lastMovementType: 'Batch scan (lot not found, showing first available batch)',
                                        lastMovementDate: new Date().toISOString().slice(0, 10)
                                    }
                                }
                            });
                        }
                    }
                }
                return res.status(404).json({
                    success: false,
                    error: validLotCode ? 'Batch not found for lot: ' + lotCode : 'batchId or lotCode missing in QR payload'
                });
            }

            const [rows] = await db.execute(`
                SELECT 
                    b.*,
                    p.name AS productName,
                    p.sku AS productSku
                FROM batches b
                INNER JOIN products p ON b.productId = p.productId
                WHERE b.batchId = ?
            `, [batchId]);

            if (!rows || rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Batch not found' });
            }

            const batch = rows[0];
            // If payload had lotCode, verify it matches (avoid wrong batch from stale batchId)
            if (validLotCode && batch.lotCode && String(batch.lotCode).trim() !== String(lotCode).trim()) {
                return res.status(404).json({
                    success: false,
                    error: 'Batch lot code mismatch: expected ' + lotCode + ', found ' + batch.lotCode
                });
            }
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            let stage = 'IN_STORAGE';
            let label = 'In Storage';
            let expiryDateText = '—';
            if (batch.expiryDate) {
                const exp = new Date(batch.expiryDate);
                exp.setHours(0, 0, 0, 0);
                const daysUntilExpiry = Math.floor((exp - today) / (1000 * 60 * 60 * 24));
                expiryDateText = exp.toISOString().slice(0, 10);
                if (daysUntilExpiry < 0) {
                    stage = 'EXPIRED';
                    label = 'Expired';
                } else if (daysUntilExpiry <= 7) {
                    label = 'Near Expiry';
                }
            }

            return res.json({
                success: true,
                data: {
                    product: {
                        productId: batch.productId,
                        name: batch.productName,
                        sku: batch.productSku
                    },
                    productId: batch.productId,
                    batchId: batch.batchId,
                    locationText: batch.location || 'N/A',
                    status: {
                        stage,
                        label
                    },
                    timeline: {
                        receivedDate: batch.receivedDate ? new Date(batch.receivedDate).toISOString().slice(0, 10) : '—',
                        expiryDate: expiryDateText
                    },
                    history: {
                        lastMovementType: 'Batch scan',
                        lastMovementDate: new Date().toISOString().slice(0, 10)
                    }
                }
            });
        }

        // Default / legacy: product-level scan
        const productId = decoded.id || decoded.productId;
        if (!productId) {
            return res.status(400).json({ success: false, error: 'Product id missing in QR payload' });
        }

        const [prodRows] = await db.execute(
            'SELECT productId, sku, name FROM products WHERE productId = ?',
            [productId]
        );
        if (!prodRows || prodRows.length === 0) {
            return res.status(404).json({ success: false, error: 'Product not found' });
        }
        const product = prodRows[0];

        // Try to find the earliest-expiring non-expired batch for context
        const [batchRows] = await db.execute(`
            SELECT * FROM batches
            WHERE productId = ?
            ORDER BY 
                CASE WHEN expiryDate IS NULL THEN 1 ELSE 0 END,
                expiryDate ASC,
                receivedDate ASC
            LIMIT 1
        `, [product.productId]);

        let batch = batchRows && batchRows[0];
        let stage = 'IN_STORAGE';
        let label = 'In Storage';
        let receivedDate = '—';
        let expiryDate = '—';
        if (batch) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            if (batch.receivedDate) {
                receivedDate = new Date(batch.receivedDate).toISOString().slice(0, 10);
            }
            if (batch.expiryDate) {
                const exp = new Date(batch.expiryDate);
                exp.setHours(0, 0, 0, 0);
                const daysUntilExpiry = Math.floor((exp - today) / (1000 * 60 * 60 * 24));
                expiryDate = exp.toISOString().slice(0, 10);
                if (daysUntilExpiry < 0) {
                    stage = 'EXPIRED';
                    label = 'Expired';
                } else if (daysUntilExpiry <= 7) {
                    label = 'Near Expiry';
                }
            }
        }

        return res.json({
            success: true,
            data: {
                product: {
                    productId: product.productId,
                    name: product.name,
                    sku: product.sku
                },
                productId: product.productId,
                batchId: batch ? batch.batchId : null,
                locationText: batch && batch.location ? batch.location : 'N/A',
                status: {
                    stage,
                    label
                },
                timeline: {
                    receivedDate,
                    expiryDate
                },
                history: {
                    lastMovementType: 'Product scan',
                    lastMovementDate: new Date().toISOString().slice(0, 10)
                }
            }
        });
    } catch (err) {
        console.error('Error handling inventory scan:', err);
        res.status(500).json({ success: false, error: 'Failed to handle scan', message: err.message });
    }
}

// CREATE/UPDATE INVENTORY ITEM
router.post('/items', async (req, res) => {
    try {
        const { productId, totalQty, available, reserved, location } = req.body;
        
        if (!productId) {
            return res.status(400).json({ 
                success: false,
                error: 'Product ID is required' 
            });
        }
        
        const [existing] = await db.execute(
            'SELECT * FROM inventory_items WHERE productId = ?',
            [productId]
        );
        
        if (existing.length > 0) {
            await db.execute(
                `UPDATE inventory_items 
                 SET totalQty = ?, available = ?, reserved = ?, location = ?
                 WHERE productId = ?`,
                [
                    totalQty !== undefined ? totalQty : existing[0].totalQty,
                    available !== undefined ? available : existing[0].available,
                    reserved !== undefined ? reserved : existing[0].reserved,
                    location || existing[0].location,
                    productId
                ]
            );
            
            const [updated] = await db.execute(
                'SELECT * FROM inventory_items WHERE productId = ?',
                [productId]
            );
            
            return res.json({
                success: true,
                message: 'Inventory updated successfully',
                data: updated[0]
            });
        } else {
            const [result] = await db.execute(
                `INSERT INTO inventory_items (productId, totalQty, available, reserved, location) 
                 VALUES (?, ?, ?, ?, ?)`,
                [
                    productId,
                    totalQty || 0,
                    available !== undefined ? available : (totalQty || 0),
                    reserved || 0,
                    location || null
                ]
            );
            
            const [newItem] = await db.execute(
                'SELECT * FROM inventory_items WHERE inventoryId = ?',
                [result.insertId]
            );
            
            return res.status(201).json({
                success: true,
                message: 'Inventory item created successfully',
                data: newItem[0]
            });
        }
    } catch (error) {
        console.error('Error creating/updating inventory:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to create/update inventory',
            message: error.message 
        });
    }
});


// GET ALL BOOKINGS
router.get('/bookings', async (req, res) => {
    try {
        // Test database connection first
        try {
            await db.testConnection();
        } catch (dbError) {
            console.error('Database connection test failed:', dbError);
            return res.status(503).json({
                success: false,
                error: 'Database connection failed',
                message: 'Cannot connect to database. Please check if MySQL is running and database credentials are correct.',
                details: dbError.message
            });
        }
        
        const { status, requestedBy } = req.query;
        
        let query = `
            SELECT 
                b.*,
                p.name as productName,
                p.sku as productSku,
                u1.name as requestedByName,
                u2.name as approvedByName
            FROM bookings b
            INNER JOIN products p ON b.productId = p.productId
            LEFT JOIN users u1 ON b.requestedBy = u1.userId
            LEFT JOIN users u2 ON b.approvedBy = u2.userId
            WHERE 1=1
        `;
        const params = [];
        
        if (status) {
            query += ` AND b.status = ?`;
            params.push(status);
        }
        
        if (requestedBy) {
            query += ` AND b.requestedBy = ?`;
            params.push(requestedBy);
        }
        
        query += ` ORDER BY b.bookingId ASC`;
        
        const [bookings] = await db.execute(query, params);
        
        res.json({
            success: true,
            count: bookings.length,
            data: bookings
        });
    } catch (error) {
        console.error('Error fetching bookings:', error);
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        res.status(500).json({ 
            success: false,
            error: 'Failed to fetch bookings',
            message: error.message || 'Unknown database error occurred',
            errorName: error.name || 'UnknownError'
        });
    }
});

// GET SINGLE BOOKING (with issuing record number for traceability)
router.get('/bookings/:id', async (req, res) => {
    try {
        const bookingId = req.params.id;
        
        const [bookings] = await db.execute(`
            SELECT 
                b.*,
                p.name as productName,
                p.sku as productSku,
                u1.name as requestedByName,
                u2.name as approvedByName,
                o.recordId AS issuingRecordId,
                o.recordNumber AS issuingRecordNumber
            FROM bookings b
            INNER JOIN products p ON b.productId = p.productId
            LEFT JOIN users u1 ON b.requestedBy = u1.userId
            LEFT JOIN users u2 ON b.approvedBy = u2.userId
            LEFT JOIN out_records o ON b.issuing_id = o.recordId
            WHERE b.bookingId = ?
        `, [bookingId]);
        
        if (bookings.length === 0) {
            return res.status(404).json({ 
                success: false,
                error: 'Booking not found' 
            });
        }
        
        const booking = bookings[0];
        const payload = {
            ...booking,
            issuingRecordId: booking.issuingRecordId ?? null,
            issuingRecordNumber: booking.issuingRecordNumber ?? null
        };
        
        res.json({
            success: true,
            data: payload
        });
    } catch (error) {
        console.error('Error fetching booking:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to fetch booking',
            message: error.message 
        });
    }
});

// CREATE BOOKING
router.post('/bookings', async (req, res) => {
    try {
        const { productId, quantity, requestedBy, neededBy, notes, orderRequester, deliveryTo } = req.body;
        
        if (!productId || !quantity || quantity <= 0 || !requestedBy) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: productId, quantity (must be > 0), requestedBy'
            });
        }
        const [products] = await db.execute(
            'SELECT * FROM products WHERE productId = ?',
            [productId]
        );
        
        if (products.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Product not found'
            });
        }
        
        const bookingNumber = await generateBookingNumber();
        const [result] = await db.execute(
            `INSERT INTO bookings 
             (bookingNumber, productId, quantity, requestedBy, neededBy, notes, orderRequester, deliveryTo)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                bookingNumber,
                productId,
                quantity,
                requestedBy,
                neededBy || null,
                notes || null,
                (orderRequester && String(orderRequester).trim()) || null,
                (deliveryTo && String(deliveryTo).trim()) || null
            ]
        );
        
        const [newBooking] = await db.execute(`
            SELECT 
                b.*,
                p.name as productName,
                p.sku as productSku,
                u1.name as requestedByName
            FROM bookings b
            INNER JOIN products p ON b.productId = p.productId
            LEFT JOIN users u1 ON b.requestedBy = u1.userId
            WHERE b.bookingId = ?
        `, [result.insertId]);
        
        const reqInfo = newBooking[0].orderRequester
            ? ` for ${newBooking[0].orderRequester}` + (newBooking[0].deliveryTo ? ` (deliver to: ${newBooking[0].deliveryTo})` : '')
            : '';
        await notifyAdmins(
            `New booking ${newBooking[0].bookingNumber} needs approval: ${newBooking[0].productName} (${newBooking[0].quantity} ${products[0].unit})${reqInfo} - created by ${newBooking[0].requestedByName}`,
            { triggeredBy: requestedBy, relatedEntityType: 'booking', relatedEntityId: result.insertId }
        );
        
        res.status(201).json({
            success: true,
            message: 'Booking created successfully',
            data: newBooking[0]
        });
    } catch (error) {
        console.error('Error creating booking:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to create booking',
            message: error.message 
        });
    }
});

const MIN_REASON_LENGTH = 1;

// APPROVE BOOKING (must be before /bookings/:id to match /bookings/:id/approve)
router.put('/bookings/:id/approve', async (req, res) => {
    try {
        const bookingId = req.params.id;
        const { approvedBy, reason, approvalReason } = req.body;
        const note = (approvalReason != null ? String(approvalReason) : reason != null ? String(reason) : '').trim();
        if (!note || note.length < MIN_REASON_LENGTH) {
            return res.status(400).json({ success: false, error: 'Reason is required and cannot be empty.' });
        }
        
        const [existing] = await db.execute(
            'SELECT * FROM bookings WHERE bookingId = ?',
            [bookingId]
        );
        
        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Booking not found'
            });
        }
        
        if (existing[0].status !== 'PENDING') {
            return res.status(400).json({
                success: false,
                error: 'Can only approve PENDING bookings'
            });
        }
        
        try {
            await db.execute(
                `UPDATE bookings 
                 SET status = 'APPROVED',
                     approvedBy = ?,
                     approvedDate = CURDATE(),
                     approvalReason = ?
                 WHERE bookingId = ?`,
                [approvedBy || null, note.slice(0, 500), bookingId]
            );
        } catch (colErr) {
            if (colErr.code === 'ER_BAD_FIELD_ERROR' && colErr.message && colErr.message.includes('approvalReason')) {
                await db.execute(
                    `UPDATE bookings SET status = 'APPROVED', approvedBy = ?, approvedDate = CURDATE() WHERE bookingId = ?`,
                    [approvedBy || null, bookingId]
                );
            } else throw colErr;
        }
        
        const [updated] = await db.execute(`
            SELECT 
                b.*,
                p.name as productName,
                p.sku as productSku,
                u1.name as requestedByName,
                u2.name as approvedByName
            FROM bookings b
            INNER JOIN products p ON b.productId = p.productId
            LEFT JOIN users u1 ON b.requestedBy = u1.userId
            LEFT JOIN users u2 ON b.approvedBy = u2.userId
            WHERE b.bookingId = ?
        `, [bookingId]);
        
        // Fire-and-forget notification (don't block response)
        notifyUser(
            existing[0].requestedBy,
            `Your booking ${updated[0].bookingNumber} for ${updated[0].productName} was approved.`,
            { triggeredBy: approvedBy || null, relatedEntityType: 'booking', relatedEntityId: parseInt(bookingId), notificationType: 'SUCCESS', sendEmail: true, emailSubject: 'Booking Approved' }
        ).catch(err => console.error('[booking approve] notifyUser:', err.message));
        
        res.json({
            success: true,
            message: 'Booking approved successfully',
            data: updated[0]
        });
    } catch (error) {
        console.error('Error approving booking:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to approve booking',
            message: error.message 
        });
    }
});

// CANCEL BOOKING (must be before /bookings/:id to match /bookings/:id/cancel)
router.put('/bookings/:id/cancel', async (req, res) => {
    try {
        const bookingId = req.params.id;
        const { rejectReason, reason, cancelledBy } = req.body;
        const reasonVal = (rejectReason != null ? String(rejectReason) : reason != null ? String(reason) : '').trim();
        if (!reasonVal || reasonVal.length < MIN_REASON_LENGTH) {
            return res.status(400).json({ success: false, error: 'Reason is required and cannot be empty.' });
        }
        
        const [existing] = await db.execute(
            'SELECT * FROM bookings WHERE bookingId = ?',
            [bookingId]
        );
        
        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Booking not found'
            });
        }
        
        if (existing[0].status === 'FULFILLED') {
            return res.status(400).json({
                success: false,
                error: 'Cannot cancel FULFILLED bookings'
            });
        }
        
        // Update status; rejectReason only if column exists (added in enhancements)
        try {
            await db.execute(
                `UPDATE bookings 
                 SET status = 'CANCELLED',
                     rejectReason = COALESCE(?, rejectReason)
                 WHERE bookingId = ?`,
                [reasonVal.slice(0, 500), bookingId]
            );
        } catch (colErr) {
            if (colErr.code === 'ER_BAD_FIELD_ERROR' && colErr.message && colErr.message.includes('rejectReason')) {
                await db.execute(
                    `UPDATE bookings SET status = 'CANCELLED' WHERE bookingId = ?`,
                    [bookingId]
                );
            } else {
                throw colErr;
            }
        }
        
        const [updated] = await db.execute(`
            SELECT 
                b.*,
                p.name as productName,
                p.sku as productSku
            FROM bookings b
            INNER JOIN products p ON b.productId = p.productId
            WHERE b.bookingId = ?
        `, [bookingId]);
        
        const msg = `Your booking ${updated[0].bookingNumber} for ${updated[0].productName} was cancelled. Reason: ${reasonVal}`;
        notifyUser(
            existing[0].requestedBy,
            msg,
            { triggeredBy: cancelledBy || 1, relatedEntityType: 'booking', relatedEntityId: parseInt(bookingId), notificationType: 'WARNING' }
        ).catch(err => console.error('[booking cancel] notifyUser:', err.message));
        
        res.json({
            success: true,
            message: 'Booking cancelled successfully',
            data: updated[0]
        });
    } catch (error) {
        console.error('Error cancelling booking:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to cancel booking',
            message: error.message 
        });
    }
});

// UPDATE BOOKING
router.put('/bookings/:id', async (req, res) => {
    try {
        const bookingId = req.params.id;
        const { quantity, neededBy, notes } = req.body;
        
        const [existing] = await db.execute(
            'SELECT * FROM bookings WHERE bookingId = ?',
            [bookingId]
        );
        
        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Booking not found'
            });
        }
        
        if (existing[0].status !== 'PENDING') {
            return res.status(400).json({
                success: false,
                error: 'Can only update PENDING bookings'
            });
        }
        
        await db.execute(
            `UPDATE bookings 
             SET quantity = COALESCE(?, quantity),
                 neededBy = COALESCE(?, neededBy),
                 notes = COALESCE(?, notes)
             WHERE bookingId = ?`,
            [quantity, neededBy, notes, bookingId]
        );
        
        const [updated] = await db.execute(`
            SELECT 
                b.*,
                p.name as productName,
                p.sku as productSku,
                u1.name as requestedByName
            FROM bookings b
            INNER JOIN products p ON b.productId = p.productId
            LEFT JOIN users u1 ON b.requestedBy = u1.userId
            WHERE b.bookingId = ?
        `, [bookingId]);
        
        res.json({
            success: true,
            message: 'Booking updated successfully',
            data: updated[0]
        });
    } catch (error) {
        console.error('Error updating booking:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to update booking',
            message: error.message 
        });
    }
});

// DELETE BOOKING
router.delete('/bookings/:id', async (req, res) => {
    try {
        const bookingId = req.params.id;
        
        const [existing] = await db.execute(
            'SELECT * FROM bookings WHERE bookingId = ?',
            [bookingId]
        );
        
        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Booking not found'
            });
        }
        
        if (existing[0].status === 'FULFILLED') {
            return res.status(400).json({
                success: false,
                error: 'Cannot delete FULFILLED bookings'
            });
        }
        
        await db.execute(
            'DELETE FROM bookings WHERE bookingId = ?',
            [bookingId]
        );
        
        res.json({
            success: true,
            message: 'Booking deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting booking:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to delete booking',
            message: error.message 
        });
    }
});


// GET ALL ISSUING RECORDS
router.get('/issuing', async (req, res) => {
    try {
        // Test database connection first
        try {
            await db.testConnection();
        } catch (dbError) {
            console.error('Database connection test failed:', dbError);
            console.error('DB Error code:', dbError.code);
            
            let dbErrorMessage = 'Cannot connect to database.';
            if (dbError.code === 'ECONNREFUSED') {
                dbErrorMessage = 'Cannot connect to MySQL server. Please start MySQL server.';
            } else if (dbError.code === 'ER_ACCESS_DENIED_ERROR') {
                dbErrorMessage = 'Database access denied. Check username/password in .env file.';
            } else if (dbError.code === 'ER_BAD_DB_ERROR') {
                dbErrorMessage = `Database "${resolvedDbLabel()}" does not exist or is not accessible. Create it and run setup.sql (Aiven: defaultdb).`;
            } else if (dbError.message) {
                dbErrorMessage = dbError.message;
            }
            
            return res.status(503).json({
                success: false,
                error: 'Database connection failed',
                message: dbErrorMessage,
                errorCode: dbError.code || 'UNKNOWN'
            });
        }
        
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
        console.error('Error code:', error.code);
        console.error('Error message:', error.message);
        console.error('Error sqlMessage:', error.sqlMessage);
        
        let errorMessage = 'Database connection error';
        if (error.code === 'ECONNREFUSED') {
            errorMessage = 'Cannot connect to MySQL server. Please start MySQL server.';
        } else if (error.code === 'ER_ACCESS_DENIED_ERROR') {
            errorMessage = 'Database access denied. Check username/password in .env file.';
        } else if (error.code === 'ER_BAD_DB_ERROR') {
            errorMessage = `Database "${resolvedDbLabel()}" does not exist or is not accessible. Create it and run setup.sql (Aiven: defaultdb).`;
        } else if (error.message) {
            errorMessage = error.message;
        } else if (error.sqlMessage) {
            errorMessage = error.sqlMessage;
        }
        
        res.status(500).json({ 
            success: false,
            error: 'Failed to fetch issuing records',
            message: errorMessage,
            errorCode: error.code || 'UNKNOWN',
            errorName: error.name || 'Error'
        });
    }
});

// GET SINGLE ISSUING RECORD
router.get('/issuing/:id', async (req, res) => {
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

// ISSUE STOCK (Create Out Record)
router.post('/issuing', async (req, res) => {
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
        
        if (!productId || !quantity || quantity <= 0 || !recipient) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: productId, quantity (must be > 0), recipient'
            });
        }
        
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
            
            if (fefoResult.allocation.length > 0) {
                finalBatchId = fefoResult.allocation[0].batchId;
                fefoAllocation = fefoResult.allocation;
            }
        } else {
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
        
        let issuedByName = null;
        if (issuedBy) {
            const [users] = await connection.execute(
                'SELECT name FROM users WHERE userId = ?',
                [issuedBy]
            );
            issuedByName = users.length > 0 ? users[0].name : null;
        }
        
        const recordNumber = await generateRecordNumber('OUT');

        const insertValuesWithoutWarehouse = [
            recordNumber,
            productId,
            finalBatchId,
            quantity,
            recipient,
            issuedByName,
            issuedDate || new Date().toISOString().split('T')[0],
            notes || null
        ];

        let recordResult;
        try {
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
        
        checkAndCreateAlerts(productId).catch(err => console.error('[issuing] alert check failed:', err.message));
        
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

// GET FEFO PREVIEW
router.get('/issuing/fefo/preview/:productId/:quantity', async (req, res) => {
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

// UPDATE ISSUING RECORD
router.put('/issuing/:id', async (req, res) => {
    const connection = await pool.getConnection();
    
    try {
        const recordId = parseInt(req.params.id);
        const { quantity, recipient, issuedDate, notes, userId, userRole } = req.body;
        
        if (!userId || !userRole) {
            return res.status(400).json({
                success: false,
                error: 'User ID and role are required'
            });
        }
        
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
        const isAdmin = userRole.toUpperCase() === 'ADMIN';
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


// GET ALL RECEIVING RECORDS
router.get('/receiving', async (req, res) => {
    try {
        // Test database connection first
        try {
            await db.testConnection();
        } catch (dbError) {
            console.error('Database connection test failed:', dbError);
            console.error('DB Error code:', dbError.code);
            
            let dbErrorMessage = 'Cannot connect to database.';
            if (dbError.code === 'ECONNREFUSED') {
                dbErrorMessage = 'Cannot connect to MySQL server. Please start MySQL server.';
            } else if (dbError.code === 'ER_ACCESS_DENIED_ERROR') {
                dbErrorMessage = 'Database access denied. Check username/password in .env file.';
            } else if (dbError.code === 'ER_BAD_DB_ERROR') {
                dbErrorMessage = `Database "${resolvedDbLabel()}" does not exist or is not accessible. Create it and run setup.sql (Aiven: defaultdb).`;
            } else if (dbError.message) {
                dbErrorMessage = dbError.message;
            }
            
            return res.status(503).json({
                success: false,
                error: 'Database connection failed',
                message: dbErrorMessage,
                errorCode: dbError.code || 'UNKNOWN'
            });
        }
        
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
        console.error('Error code:', error.code);
        console.error('Error message:', error.message);
        console.error('Error sqlMessage:', error.sqlMessage);
        
        let errorMessage = 'Database connection error';
        if (error.code === 'ECONNREFUSED') {
            errorMessage = 'Cannot connect to MySQL server. Please start MySQL server.';
        } else if (error.code === 'ER_ACCESS_DENIED_ERROR') {
            errorMessage = 'Database access denied. Check username/password in .env file.';
        } else if (error.code === 'ER_BAD_DB_ERROR') {
            errorMessage = `Database "${resolvedDbLabel()}" does not exist or is not accessible. Create it and run setup.sql (Aiven: defaultdb).`;
        } else if (error.message) {
            errorMessage = error.message;
        } else if (error.sqlMessage) {
            errorMessage = error.sqlMessage;
        }
        
        res.status(500).json({ 
            success: false,
            error: 'Failed to fetch receiving records',
            message: errorMessage,
            errorCode: error.code || 'UNKNOWN',
            errorName: error.name || 'Error'
        });
    }
});

// GET SINGLE RECEIVING RECORD
router.get('/receiving/:id', async (req, res) => {
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

// RECEIVE STOCK (Create Batch + In Record)
router.post('/receiving', async (req, res) => {
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
            receivedBy,
            installationDate 
        } = req.body;
        
        if (!productId || !lotCode || !quantity || quantity <= 0) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: productId, lotCode, quantity (must be > 0)'
            });
        }
        
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
        
        const [existingBatches] = await connection.execute(
            'SELECT * FROM batches WHERE lotCode = ?',
            [lotCode]
        );
        
        let batchId;
        
        const product = products[0];
        const instDate = installationDate || receivedDate || new Date().toISOString().split('T')[0];
        // warrantyMonths / maintenanceIntervalMonths columns store day counts (UI labels: days).
        const addDays = (dateStr, days) => {
            const d = new Date(dateStr + 'T12:00:00');
            d.setDate(d.getDate() + Number(days));
            return d.toISOString().split('T')[0];
        };
        const warrantyExpiry = (product.warrantyMonths && instDate) ? addDays(instDate, product.warrantyMonths) : null;
        const nextMaintenanceDue = (product.maintenanceIntervalMonths && instDate) ? addDays(instDate, product.maintenanceIntervalMonths) : null;

        if (existingBatches.length > 0) {
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
            const [batchResult] = await connection.execute(
                `INSERT INTO batches 
                 (productId, lotCode, quantity, expiryDate, receivedDate, supplier, location, notes, installationDate, warrantyExpiry, nextMaintenanceDue)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    productId,
                    lotCode,
                    quantity,
                    expiryDate || null,
                    receivedDate || new Date().toISOString().split('T')[0],
                    supplier || null,
                    location || null,
                    notes || null,
                    instDate || null,
                    warrantyExpiry,
                    nextMaintenanceDue
                ]
            );
            
            batchId = batchResult.insertId;
        }
        
        let receivedByName = null;
        if (receivedBy) {
            const [users] = await connection.execute(
                'SELECT name FROM users WHERE userId = ?',
                [receivedBy]
            );
            receivedByName = users.length > 0 ? users[0].name : null;
        }
        
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
                receivedByName,
                receivedDate || new Date().toISOString().split('T')[0],
                notes || null
            ]
        );
        
        const [existingInventory] = await connection.execute(
            'SELECT * FROM inventory_items WHERE productId = ?',
            [productId]
        );
        
        if (existingInventory.length > 0) {
            await connection.execute(
                `UPDATE inventory_items 
                 SET totalQty = totalQty + ?,
                     available = available + ?,
                     location = COALESCE(?, location)
                 WHERE productId = ?`,
                [quantity, quantity, location || null, productId]
            );
        } else {
            await connection.execute(
                `INSERT INTO inventory_items (productId, totalQty, available, reserved, location)
                 VALUES (?, ?, ?, 0, ?)`,
                [productId, quantity, quantity, location || null]
            );
        }
        
        await connection.commit();
        
        checkAndCreateAlerts(productId).catch(err => console.error('[receiving] alert check failed:', err.message));
        
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

// UPDATE RECEIVING RECORD
router.put('/receiving/:id', async (req, res) => {
    const connection = await pool.getConnection();
    
    try {
        const recordId = parseInt(req.params.id);
        const { quantity, supplier, receivedDate, notes, userId, userRole } = req.body;
        
        if (!userId || !userRole) {
            return res.status(400).json({
                success: false,
                error: 'User ID and role are required'
            });
        }
        
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
        const isAdmin = userRole.toUpperCase() === 'ADMIN';
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
        
        const [users] = await connection.execute(
            'SELECT name FROM users WHERE userId = ?',
            [userId]
        );
        const userName = users.length > 0 ? users[0].name : null;
        
        if (userName) {
            updates.push('receivedBy = ?');
            values.splice(values.length - 1, 0, userName);
        }
        
        await connection.execute(
            `UPDATE in_records SET ${updates.join(', ')} WHERE recordId = ?`,
            values
        );
        
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
router.parseScanPayload = parseScanPayload;
router.handleScanRequest = handleScanRequest;
