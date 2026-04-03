-- ============================================
-- Populate Alerts and Bookings Sample Data
-- ============================================
-- Run this after populate_sample_data.sql
-- 
-- Instructions:
-- mysql -u root -h 127.0.0.1 -P 3306 swms_db < populate_alerts_bookings.sql
-- ============================================

USE swms_db;

-- ============================================
-- CREATE SAMPLE ALERTS
-- ============================================

-- Low stock alerts
INSERT INTO alerts (alertType, severity, productId, message, resolved) VALUES
('LOW_STOCK', 'WARN', 1, 'Milk - Fresh Whole has low stock (50 units remaining)', FALSE),
('LOW_STOCK', 'WARN', 3, 'Bread - White Loaf has low stock (60 units remaining)', FALSE),
('LOW_STOCK', 'CRITICAL', 6, 'Chicken Breast - Fresh has critical low stock (80 units remaining)', FALSE)
ON DUPLICATE KEY UPDATE message=message;

-- Near expiry alerts (batches expiring within 7 days)
INSERT INTO alerts (alertType, severity, productId, batchId, message, resolved)
SELECT 
    'NEAR_EXPIRY',
    CASE 
        WHEN DATEDIFF(b.expiryDate, CURDATE()) <= 3 THEN 'CRITICAL'
        ELSE 'WARN'
    END,
    b.productId,
    b.batchId,
    CONCAT(p.name, ' (Lot: ', b.lotCode, ') expires in ', DATEDIFF(b.expiryDate, CURDATE()), ' days'),
    FALSE
FROM batches b
INNER JOIN products p ON b.productId = p.productId
WHERE b.expiryDate IS NOT NULL
    AND b.expiryDate >= CURDATE()
    AND b.expiryDate <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)
    AND NOT EXISTS (
        SELECT 1 FROM alerts a 
        WHERE a.batchId = b.batchId 
        AND a.alertType = 'NEAR_EXPIRY'
        AND a.resolved = FALSE
    );

-- Expired alerts
INSERT INTO alerts (alertType, severity, productId, batchId, message, resolved)
SELECT 
    'EXPIRED',
    'CRITICAL',
    b.productId,
    b.batchId,
    CONCAT(p.name, ' (Lot: ', b.lotCode, ') has expired on ', b.expiryDate),
    FALSE
FROM batches b
INNER JOIN products p ON b.productId = p.productId
WHERE b.expiryDate IS NOT NULL
    AND b.expiryDate < CURDATE()
    AND b.quantity > 0
    AND NOT EXISTS (
        SELECT 1 FROM alerts a 
        WHERE a.batchId = b.batchId 
        AND a.alertType = 'EXPIRED'
        AND a.resolved = FALSE
    );

-- ============================================
-- CREATE SAMPLE BOOKINGS
-- ============================================

-- Pending bookings
INSERT INTO bookings (bookingNumber, productId, quantity, requestedBy, requestedDate, neededBy, status, notes) VALUES
('BK-2024-001', 1, 50, 1, DATE_SUB(CURDATE(), INTERVAL 2 DAY), DATE_ADD(CURDATE(), INTERVAL 5 DAY), 'PENDING', 'Urgent order for customer'),
('BK-2024-002', 2, 100, 1, DATE_SUB(CURDATE(), INTERVAL 1 DAY), DATE_ADD(CURDATE(), INTERVAL 7 DAY), 'PENDING', 'Bulk order'),
('BK-2024-003', 4, 30, 2, CURDATE(), DATE_ADD(CURDATE(), INTERVAL 3 DAY), 'PENDING', 'Regular weekly order')
ON DUPLICATE KEY UPDATE notes=notes;

-- Approved bookings
INSERT INTO bookings (bookingNumber, productId, quantity, requestedBy, requestedDate, neededBy, status, approvedBy, approvedDate, notes) VALUES
('BK-2024-004', 5, 25, 1, DATE_SUB(CURDATE(), INTERVAL 5 DAY), DATE_ADD(CURDATE(), INTERVAL 2 DAY), 'APPROVED', 1, DATE_SUB(CURDATE(), INTERVAL 4 DAY), 'Coffee order'),
('BK-2024-005', 7, 40, 2, DATE_SUB(CURDATE(), INTERVAL 3 DAY), DATE_ADD(CURDATE(), INTERVAL 4 DAY), 'APPROVED', 1, DATE_SUB(CURDATE(), INTERVAL 2 DAY), 'Tomatoes for kitchen')
ON DUPLICATE KEY UPDATE notes=notes;

-- Fulfilled bookings
INSERT INTO bookings (bookingNumber, productId, quantity, requestedBy, requestedDate, neededBy, status, approvedBy, approvedDate, notes) VALUES
('BK-2024-006', 3, 20, 1, DATE_SUB(CURDATE(), INTERVAL 10 DAY), DATE_SUB(CURDATE(), INTERVAL 5 DAY), 'FULFILLED', 1, DATE_SUB(CURDATE(), INTERVAL 8 DAY), 'Bread order - completed'),
('BK-2024-007', 8, 15, 2, DATE_SUB(CURDATE(), INTERVAL 7 DAY), DATE_SUB(CURDATE(), INTERVAL 2 DAY), 'FULFILLED', 1, DATE_SUB(CURDATE(), INTERVAL 6 DAY), 'Milk powder order')
ON DUPLICATE KEY UPDATE notes=notes;

-- Cancelled booking
INSERT INTO bookings (bookingNumber, productId, quantity, requestedBy, requestedDate, neededBy, status, notes) VALUES
('BK-2024-008', 9, 50, 1, DATE_SUB(CURDATE(), INTERVAL 4 DAY), DATE_ADD(CURDATE(), INTERVAL 1 DAY), 'CANCELLED', 'Order cancelled by customer')
ON DUPLICATE KEY UPDATE notes=notes;

-- ============================================
-- SUCCESS MESSAGE
-- ============================================
SELECT 
    'Alerts and bookings populated successfully! ✅' AS message,
    (SELECT COUNT(*) FROM alerts WHERE resolved = FALSE) AS active_alerts,
    (SELECT COUNT(*) FROM alerts WHERE resolved = TRUE) AS resolved_alerts,
    (SELECT COUNT(*) FROM bookings WHERE status = 'PENDING') AS pending_bookings,
    (SELECT COUNT(*) FROM bookings WHERE status = 'APPROVED') AS approved_bookings,
    (SELECT COUNT(*) FROM bookings WHERE status = 'FULFILLED') AS fulfilled_bookings;





