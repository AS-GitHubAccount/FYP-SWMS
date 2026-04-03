-- ============================================
-- Populate Sample Out Records (Issuing Records)
-- ============================================
-- This creates sample out_records so you can see data
-- Run this after you have batches in the database
-- 
-- Instructions:
-- mysql -u root -h 127.0.0.1 -P 3306 swms_db < populate_sample_out_records.sql
-- ============================================

USE swms_db;

-- ============================================
-- CREATE SAMPLE OUT RECORDS
-- ============================================
-- Note: This assumes you have batches in the database
-- If you don't have batches, run populate_sample_data.sql first

-- Get some batches to issue from
SET @batch1 = (SELECT batchId FROM batches WHERE productId = 1 LIMIT 1);
SET @batch2 = (SELECT batchId FROM batches WHERE productId = 2 LIMIT 1);
SET @batch3 = (SELECT batchId FROM batches WHERE productId = 3 LIMIT 1);
SET @batch4 = (SELECT batchId FROM batches WHERE productId = 4 LIMIT 1);
SET @batch5 = (SELECT batchId FROM batches WHERE productId = 5 LIMIT 1);

-- Create out_records (only if batches exist)
INSERT INTO out_records (recordNumber, productId, batchId, quantity, recipient, issuedBy, issuedDate, notes)
SELECT 
    CONCAT('OUT-', LPAD(ROW_NUMBER() OVER (ORDER BY b.batchId), 6, '0')) as recordNumber,
    b.productId,
    b.batchId,
    LEAST(10, FLOOR(b.quantity * 0.1)) as quantity, -- Issue 10% of batch quantity, max 10
    CASE (ROW_NUMBER() OVER (ORDER BY b.batchId) % 4)
        WHEN 0 THEN 'Customer A'
        WHEN 1 THEN 'Customer B'
        WHEN 2 THEN 'Internal Use'
        ELSE 'Customer C'
    END as recipient,
    1 as issuedBy, -- Assuming user ID 1 exists
    DATE_SUB(CURDATE(), INTERVAL (ROW_NUMBER() OVER (ORDER BY b.batchId) % 7) DAY) as issuedDate,
    CONCAT('Sample issue record for ', p.name) as notes
FROM batches b
INNER JOIN products p ON b.productId = p.productId
WHERE b.quantity > 0
LIMIT 10
ON DUPLICATE KEY UPDATE notes=notes;

-- Update inventory_items to reflect issued quantities
UPDATE inventory_items i
INNER JOIN (
    SELECT 
        productId,
        SUM(quantity) as totalIssued
    FROM out_records
    GROUP BY productId
) o ON i.productId = o.productId
SET 
    i.available = GREATEST(0, i.available - o.totalIssued),
    i.reserved = i.reserved + o.totalIssued;

-- ============================================
-- SUCCESS MESSAGE
-- ============================================
SELECT 
    'Sample out_records created successfully! ✅' AS message,
    (SELECT COUNT(*) FROM out_records) AS total_out_records,
    (SELECT COUNT(DISTINCT productId) FROM out_records) AS products_issued,
    (SELECT SUM(quantity) FROM out_records) AS total_quantity_issued;





