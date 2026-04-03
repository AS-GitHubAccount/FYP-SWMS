/**
 * Products API Routes
 * 
 * Handles all product-related endpoints:
 * - GET /api/products - Get all products
 * - GET /api/products/:id - Get single product
 * - POST /api/products - Create new product
 * - PUT /api/products/:id - Update product
 * - DELETE /api/products/:id - Delete product
 */

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const QRCode = require('qrcode');
const { requireCriticalApproval } = require('../utils/criticalApproval');
const { logAudit, getClientIp, getUserAgent } = require('../utils/auditLogger');

// ============================================
// GET ALL PRODUCTS
// ============================================
router.get('/', async (req, res) => {
    try {
        // Query database
        const [products] = await db.execute(
            'SELECT * FROM products ORDER BY createdAt DESC'
        );
        
        res.json({
            success: true,
            count: products.length,
            data: products
        });
    } catch (error) {
        console.error('Error fetching products:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to fetch products',
            message: error.message 
        });
    }
});

// ============================================
// GET PRODUCT QR CODE (JSON payload: type, id, sku → PNG data URL)
// ============================================
router.get('/:id/qr', async (req, res) => {
    try {
        const rawId = req.params.id;
        const productId = parseInt(rawId, 10);
        if (!productId || isNaN(productId)) {
            return res.status(400).json({ success: false, error: 'Invalid product ID' });
        }
        const [products] = await db.execute('SELECT productId, sku, name FROM products WHERE productId = ?', [productId]);
        if (!products || products.length === 0) {
            return res.status(404).json({ success: false, error: 'Product not found' });
        }
        const p = products[0];
        const payload = { type: 'INV_ITEM', id: String(p.productId), sku: (p.sku != null && p.sku !== '') ? String(p.sku) : '', name: (p.name != null && p.name !== '') ? String(p.name).slice(0, 80) : '' };
        const jsonStr = JSON.stringify(payload);
        const dataUrl = await QRCode.toDataURL(jsonStr, { type: 'image/png', margin: 1, width: 200, color: { dark: '#0f172a', light: '#ffffff' } });
        if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) {
            return res.status(500).json({ success: false, error: 'QR generation failed' });
        }
        await logAudit({
            tableName: 'qr_generate',
            recordId: p.productId,
            action: 'QR_GENERATE',
            userId: req.user && req.user.userId,
            userName: (req.user && req.user.name) || (req.user && req.user.email) || null,
            oldValues: null,
            newValues: { productId: p.productId, scope: 'product' },
            ipAddress: getClientIp(req),
            userAgent: getUserAgent(req)
        });
        res.json({ success: true, dataUrl, payload });
    } catch (err) {
        console.error('Error generating product QR:', err);
        res.status(500).json({ success: false, error: err.message || 'QR generation failed' });
    }
});

// ============================================
// GET SINGLE PRODUCT BY ID
// ============================================
router.get('/:id', async (req, res) => {
    try {
        const productId = req.params.id;
        
        // Query database
        const [products] = await db.execute(
            'SELECT * FROM products WHERE productId = ?',
            [productId]
        );
        
        // Check if product exists
        if (products.length === 0) {
            return res.status(404).json({ 
                success: false,
                error: 'Product not found' 
            });
        }
        
        res.json({
            success: true,
            data: products[0]
        });
    } catch (error) {
        console.error('Error fetching product:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to fetch product',
            message: error.message 
        });
    }
});

// ============================================
// CREATE NEW PRODUCT
// ============================================
router.post('/', async (req, res) => {
    try {
        const { sku, name, category, unit, minStock, productType, warrantyMonths, maintenanceIntervalMonths } = req.body;
        
        // Validate required fields
        if (!sku || !name) {
            return res.status(400).json({ 
                success: false,
                error: 'SKU and name are required' 
            });
        }
        
        const pType = ['GOODS', 'EQUIPMENT', 'SERVICE', 'GOODS_WITH_SERVICE'].includes(productType) ? productType : 'GOODS';
        // DB columns warrantyMonths / maintenanceIntervalMonths hold day counts (see inventory receiving).
        const warr = warrantyMonths != null ? parseInt(warrantyMonths, 10) : null;
        const maint = maintenanceIntervalMonths != null ? parseInt(maintenanceIntervalMonths, 10) : null;
        
        const [result] = await db.execute(
            `INSERT INTO products (sku, name, category, unit, minStock, productType, warrantyMonths, maintenanceIntervalMonths) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                sku,
                name,
                category || null,
                unit || 'unit',
                minStock || 0,
                pType,
                isNaN(warr) ? null : warr,
                isNaN(maint) ? null : maint
            ]
        );
        
        const productId = result.insertId;
        
        // Create inventory_items row so the product appears in the inventory list (GET /api/inventory uses INNER JOIN)
        try {
            await db.execute(
                `INSERT INTO inventory_items (productId, totalQty, available, reserved, location) VALUES (?, 0, 0, 0, NULL)`,
                [productId]
            );
        } catch (invErr) {
            // If inventory_items has extra columns (e.g. warehouseId), try minimal insert
            if (invErr.code === 'ER_BAD_FIELD_ERROR' || invErr.code === 'ER_NO_DEFAULT_FOR_FIELD') {
                try {
                    await db.execute(
                        `INSERT INTO inventory_items (productId, totalQty, available, reserved) VALUES (?, 0, 0, 0)`,
                        [productId]
                    );
                } catch (e2) {
                    console.warn('Could not create inventory_items for new product:', e2.message);
                }
            } else {
                console.warn('Could not create inventory_items for new product:', invErr.message);
            }
        }
        
        // Get the created product
        const [newProduct] = await db.execute(
            'SELECT * FROM products WHERE productId = ?',
            [productId]
        );
        
        res.status(201).json({
            success: true,
            message: 'Product created successfully',
            data: newProduct[0]
        });
    } catch (error) {
        console.error('Error creating product:', error);
        
        // Handle duplicate SKU error
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ 
                success: false,
                error: 'Product with this SKU already exists' 
            });
        }
        
        res.status(500).json({ 
            success: false,
            error: 'Failed to create product',
            message: error.message 
        });
    }
});

// ============================================
// UPDATE PRODUCT
// ============================================
router.put('/:id', async (req, res) => {
    try {
        const productId = req.params.id;
        const { sku, name, category, unit, minStock, productType, warrantyMonths, maintenanceIntervalMonths, location } = req.body;
        
        const [existing] = await db.execute(
            'SELECT * FROM products WHERE productId = ?',
            [productId]
        );
        
        if (existing.length === 0) {
            return res.status(404).json({ 
                success: false,
                error: 'Product not found' 
            });
        }
        
        const pType = productType !== undefined
            ? (['GOODS', 'EQUIPMENT', 'SERVICE', 'GOODS_WITH_SERVICE'].includes(productType) ? productType : existing[0].productType || 'GOODS')
            : (existing[0].productType || 'GOODS');
        const warr = warrantyMonths !== undefined ? (warrantyMonths === '' || warrantyMonths == null ? null : parseInt(warrantyMonths, 10)) : existing[0].warrantyMonths;
        const maint = maintenanceIntervalMonths !== undefined ? (maintenanceIntervalMonths === '' || maintenanceIntervalMonths == null ? null : parseInt(maintenanceIntervalMonths, 10)) : existing[0].maintenanceIntervalMonths;
        
        const newSku = (sku !== undefined && sku !== null && String(sku).trim() !== '') ? String(sku).trim() : null;
        if (newSku && newSku !== existing[0].sku) {
            const [dup] = await db.execute('SELECT productId FROM products WHERE sku = ? AND productId != ?', [newSku, productId]);
            if (dup.length > 0) {
                return res.status(400).json({ success: false, error: 'Product with this SKU already exists' });
            }
        }
        
        // Try full update first (includes productType, warrantyMonths, maintenanceIntervalMonths, sku)
        try {
            const setSku = newSku ? 'sku = ?,' : '';
            const params = [
                name || existing[0].name,
                category !== undefined ? category : existing[0].category,
                unit || existing[0].unit,
                minStock !== undefined ? minStock : existing[0].minStock,
                pType,
                (warr != null && !isNaN(warr)) ? warr : null,
                (maint != null && !isNaN(maint)) ? maint : null
            ];
            if (newSku) params.unshift(newSku);
            await db.execute(
                `UPDATE products 
                 SET ${setSku} name = ?, category = ?, unit = ?, minStock = ?, productType = ?, warrantyMonths = ?, maintenanceIntervalMonths = ?
                 WHERE productId = ?`,
                [...params, productId]
            );
        } catch (colErr) {
            if (colErr.code === 'ER_BAD_FIELD_ERROR') {
                const baseParams = [name || existing[0].name, category !== undefined ? category : existing[0].category, unit || existing[0].unit, minStock !== undefined ? minStock : existing[0].minStock, productId];
                if (newSku) {
                    await db.execute('UPDATE products SET sku = ?, name = ?, category = ?, unit = ?, minStock = ? WHERE productId = ?', [newSku, ...baseParams.slice(0, -1), productId]);
                } else {
                    await db.execute('UPDATE products SET name = ?, category = ?, unit = ?, minStock = ? WHERE productId = ?', baseParams);
                }
            } else if (colErr.code === 'ER_DUP_ENTRY') {
                return res.status(400).json({ success: false, error: 'Product with this SKU already exists' });
            } else {
                throw colErr;
            }
        }
        
        if (location !== undefined) {
            try {
                const [upd] = await db.execute(
                    'UPDATE inventory_items SET location = ? WHERE productId = ?',
                    [location || null, productId]
                );
                if (upd.affectedRows === 0) {
                    await db.execute(
                        'INSERT INTO inventory_items (productId, totalQty, available, reserved, location) VALUES (?, 0, 0, 0, ?)',
                        [productId, location || null]
                    );
                }
            } catch (locErr) {
                if (locErr.code === 'ER_BAD_FIELD_ERROR' || locErr.code === 'ER_NO_DEFAULT_FOR_FIELD') {
                    try {
                        await db.execute(
                            'INSERT INTO inventory_items (productId, totalQty, available, reserved) VALUES (?, 0, 0, 0)',
                            [productId]
                        );
                    } catch (e2) {}
                } else if (locErr.code !== 'ER_DUP_ENTRY') {
                    console.warn('Could not update inventory_items location:', locErr.message);
                }
            }
        }
        
        const [updated] = await db.execute(
            'SELECT * FROM products WHERE productId = ?',
            [productId]
        );
        
        res.json({
            success: true,
            message: 'Product updated successfully',
            data: updated[0]
        });
    } catch (error) {
        console.error('Error updating product:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to update product',
            message: error.message 
        });
    }
});

// ============================================
// DELETE PRODUCT (critical: verification layer + optional approval token for Admin)
// ============================================
router.delete('/:id', async (req, res) => {
    try {
        const productId = req.params.id;
        const approvalCheck = await requireCriticalApproval(req, res, 'delete_product');
        if (approvalCheck) return;

        // Check if product exists
        const [existing] = await db.execute(
            'SELECT * FROM products WHERE productId = ?',
            [productId]
        );

        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Product not found'
            });
        }

        // Handle bookings safely before deletion:
        // - block if active bookings exist (PENDING/APPROVED)
        // - auto-clean resolved bookings (CANCELLED/FULFILLED) so FK won't block delete
        try {
            const [bookingStats] = await db.execute(
                `SELECT status, COUNT(*) AS cnt
                 FROM bookings
                 WHERE productId = ?
                 GROUP BY status`,
                [productId]
            );
            if (Array.isArray(bookingStats) && bookingStats.length > 0) {
                let activeCount = 0;
                let resolvedCount = 0;
                bookingStats.forEach(function (r) {
                    const s = String(r.status || '').toUpperCase();
                    const c = parseInt(r.cnt, 10) || 0;
                    if (s === 'PENDING' || s === 'APPROVED') activeCount += c;
                    else if (s === 'CANCELLED' || s === 'FULFILLED') resolvedCount += c;
                    else activeCount += c;
                });

                if (activeCount > 0) {
                    return res.status(409).json({
                        success: false,
                        error: 'Product is referenced',
                        message: `Cannot delete this product because ${activeCount} active booking(s) are still linked. Cancel or fulfill those bookings first.`
                    });
                }

                if (resolvedCount > 0) {
                    await db.execute(
                        `DELETE FROM bookings
                         WHERE productId = ?
                           AND status IN ('CANCELLED', 'FULFILLED')`,
                        [productId]
                    );
                }
            }
        } catch (bkErr) {
            // If bookings table is unavailable in a partial environment, continue with normal delete path.
            if (bkErr && bkErr.code !== 'ER_NO_SUCH_TABLE') {
                throw bkErr;
            }
        }

        // Delete product
        await db.execute(
            'DELETE FROM products WHERE productId = ?',
            [productId]
        );

        res.json({
            success: true,
            message: 'Product deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting product:', error);

        // Friendly handling for FK constraint failures (e.g., bookings referencing products)
        // MySQL common codes: ER_ROW_IS_REFERENCED / ER_ROW_IS_REFERENCED_2 / errno 1451
        const maybeReferenced =
            error &&
            (error.code === 'ER_ROW_IS_REFERENCED' ||
                error.code === 'ER_ROW_IS_REFERENCED_2' ||
                error.errno === 1451);

        if (maybeReferenced) {
            // Attempt to extract referencing table name from message:
            // "... fails (`swms_db`.`bookings`, CONSTRAINT ... FOREIGN KEY ... )"
            let referencedTable = 'a related record';
            const m = String(error.message || '').match(/`[^`]+`\.`([^`]+)`/);
            if (m && m[1]) referencedTable = m[1];
            const rawErr = String(error.message || '');
            const isBookingReference =
                String(referencedTable).toLowerCase() === 'bookings' ||
                /bookings/i.test(rawErr);

            // Recovery path for bookings FK:
            // If only resolved bookings remain, remove them and retry product deletion once.
            if (isBookingReference) {
                try {
                    const [bookingStats] = await db.execute(
                        `SELECT status, COUNT(*) AS cnt
                         FROM bookings
                         WHERE productId = ?
                         GROUP BY status`,
                        [req.params.id]
                    );

                    let activeCount = 0;
                    let resolvedCount = 0;
                    (bookingStats || []).forEach(function (r) {
                        const s = String(r.status || '').toUpperCase();
                        const c = parseInt(r.cnt, 10) || 0;
                        if (s === 'PENDING' || s === 'APPROVED') activeCount += c;
                        else if (s === 'CANCELLED' || s === 'FULFILLED') resolvedCount += c;
                        else activeCount += c;
                    });

                    if (activeCount > 0) {
                        return res.status(409).json({
                            success: false,
                            error: 'Product is referenced',
                            message: `Cannot delete this product because ${activeCount} active booking(s) are still linked. Cancel or fulfill those bookings first.`
                        });
                    }

                    if (resolvedCount > 0) {
                        await db.execute(
                            `DELETE FROM bookings
                             WHERE productId = ?
                               AND status IN ('CANCELLED', 'FULFILLED')`,
                            [req.params.id]
                        );
                        // Retry delete once after cleaning resolved bookings.
                        await db.execute('DELETE FROM products WHERE productId = ?', [req.params.id]);
                        return res.json({
                            success: true,
                            message: 'Product deleted successfully'
                        });
                    }
                } catch (retryErr) {
                    console.error('Error resolving booking references during delete:', retryErr);
                }
            }

            return res.status(409).json({
                success: false,
                error: 'Product is referenced',
                message:
                    `Cannot delete this product because it is referenced by ${referencedTable}. ` +
                    `Please resolve linked records first.`
            });
        }

        res.status(500).json({
            success: false,
            error: 'Failed to delete product',
            message: error.message
        });
    }
});

module.exports = router;

