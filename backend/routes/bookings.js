/**
 * Bookings API Routes
 * 
 * Handles booking-related endpoints:
 * - GET /api/bookings - Get all bookings
 * - GET /api/bookings/:id - Get single booking
 * - POST /api/bookings - Create booking
 * - PUT /api/bookings/:id - Update booking
 * - PUT /api/bookings/:id/approve - Approve booking
 * - PUT /api/bookings/:id/cancel - Cancel booking
 * - DELETE /api/bookings/:id - Delete booking
 */

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { generateBookingNumber } = require('../utils/idGenerator');
const { notifyUser } = require('../utils/notificationHelper');

const MIN_REASON_LENGTH = 1;

router.get('/', async (req, res) => {
    try {
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
        res.status(500).json({ 
            success: false,
            error: 'Failed to fetch bookings',
            message: error.message 
        });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const bookingId = req.params.id;
        let bookings;
        try {
            [bookings] = await db.execute(`
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
        } catch (colErr) {
            if (colErr.code === 'ER_BAD_FIELD_ERROR' && colErr.message && colErr.message.includes('issuing_id')) {
                [bookings] = await db.execute(`
                    SELECT 
                        b.bookingId, b.bookingNumber, b.productId, b.quantity, b.requestedBy,
                        b.requestedDate, b.neededBy, b.status, b.notes, b.approvedBy, b.approvedDate, b.rejectReason,
                        p.name as productName, p.sku as productSku,
                        u1.name as requestedByName, u2.name as approvedByName
                    FROM bookings b
                    INNER JOIN products p ON b.productId = p.productId
                    LEFT JOIN users u1 ON b.requestedBy = u1.userId
                    LEFT JOIN users u2 ON b.approvedBy = u2.userId
                    WHERE b.bookingId = ?
                `, [bookingId]);
                if (bookings && bookings.length > 0) {
                    bookings[0].issuingRecordId = null;
                    bookings[0].issuingRecordNumber = null;
                }
            } else throw colErr;
        }
        
        if (!bookings || bookings.length === 0) {
            return res.status(404).json({ 
                success: false,
                error: 'Booking not found' 
            });
        }
        
        const booking = bookings[0];
        const payload = {
            ...booking,
            issuingRecordId: booking.issuingRecordId ?? booking.issuing_id ?? null,
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

router.post('/', async (req, res) => {
    try {
        const { productId, quantity, requestedBy, neededBy, notes, orderRequester, deliveryTo } = req.body;
        
        if (!productId || !quantity || quantity <= 0 || !requestedBy) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: productId, quantity (must be > 0), requestedBy'
            });
        }
        // Check if product exists
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

router.put('/:id', async (req, res) => {
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

router.put('/:id/approve', async (req, res) => {
    try {
        const bookingId = req.params.id;
        const { approvedBy, reason, approvalReason } = req.body;
        const note = (approvalReason != null ? String(approvalReason) : reason != null ? String(reason) : '').trim();
        if (!note || note.length < MIN_REASON_LENGTH) {
            return res.status(400).json({ success: false, error: 'Approval reason is required.' });
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

        const requestedBy = existing[0].requestedBy;
        const msg = updated[0]
            ? `Your booking ${updated[0].bookingNumber} for ${updated[0].productName} was approved. Reason: ${note}`
            : `Your booking was approved. Reason: ${note}`;
        notifyUser(requestedBy, msg, {
            triggeredBy: approvedBy || null,
            relatedEntityType: 'booking',
            relatedEntityId: parseInt(bookingId),
            notificationType: 'SUCCESS'
        }).catch(err => console.error('[booking approve] notifyUser:', err.message));
        
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

router.put('/:id/cancel', async (req, res) => {
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
        
        try {
            await db.execute(
                `UPDATE bookings SET status = 'CANCELLED', rejectReason = ? WHERE bookingId = ?`,
                [reasonVal.slice(0, 500), bookingId]
            );
        } catch (colErr) {
            if (colErr.code === 'ER_BAD_FIELD_ERROR' && colErr.message && colErr.message.includes('rejectReason')) {
                await db.execute("UPDATE bookings SET status = 'CANCELLED' WHERE bookingId = ?", [bookingId]);
            } else throw colErr;
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

router.delete('/:id', async (req, res) => {
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

module.exports = router;





