-- ============================================
-- SWMS Sample Data Population Script
-- ============================================
-- This script populates the database with sample batches and inventory data
-- Run this after running setup.sql
-- 
-- Instructions:
-- 1. Make sure setup.sql has been run first
-- 2. Open MySQL command line or phpMyAdmin
-- 3. Run: source populate_sample_data.sql;  (or copy-paste this entire file)
-- ============================================

USE swms_db;

-- ============================================
-- CLEAR EXISTING DATA (Optional - uncomment if you want to reset)
-- ============================================
-- DELETE FROM in_records;
-- DELETE FROM out_records;
-- DELETE FROM bookings;
-- DELETE FROM batches;
-- DELETE FROM inventory_items;
-- DELETE FROM products WHERE productId > 5; -- Keep the sample products from setup.sql

-- ============================================
-- ADD MORE SAMPLE PRODUCTS
-- ============================================
INSERT INTO products (sku, name, category, unit, minStock) VALUES
('PRD-006', 'Chicken Breast - Fresh', 'Meat', 'kg', 30),
('PRD-007', 'Tomatoes - Fresh', 'Vegetables', 'kg', 50),
('PRD-008', 'Milk Powder - 1kg', 'Dairy', 'unit', 40),
('PRD-009', 'Cooking Oil - 2L', 'Pantry', 'bottle', 60),
('PRD-010', 'Sugar - White 5kg', 'Pantry', 'bag', 80),
('PRD-011', 'Flour - All Purpose 10kg', 'Bakery', 'bag', 50),
('PRD-012', 'Eggs - Large Grade A', 'Dairy', 'dozen', 100),
('PRD-013', 'Onions - Yellow', 'Vegetables', 'kg', 40),
('PRD-014', 'Potatoes - Russet', 'Vegetables', 'kg', 60),
('PRD-015', 'Pasta - Spaghetti 500g', 'Pantry', 'pack', 120)
ON DUPLICATE KEY UPDATE name=name;

-- ============================================
-- CREATE SAMPLE BATCHES
-- ============================================

-- Batches for PRD-001 (Milk - Fresh Whole)
INSERT INTO batches (productId, lotCode, quantity, expiryDate, receivedDate, supplier, location, notes) VALUES
(1, 'LOT-2024-001', 150, DATE_ADD(CURDATE(), INTERVAL 7 DAY), DATE_SUB(CURDATE(), INTERVAL 2 DAY), 'Fresh Dairy Co.', 'Warehouse A - Cold Storage', 'Fresh delivery'),
(1, 'LOT-2024-002', 200, DATE_ADD(CURDATE(), INTERVAL 14 DAY), DATE_SUB(CURDATE(), INTERVAL 1 DAY), 'Fresh Dairy Co.', 'Warehouse A - Cold Storage', 'Bulk order'),
(1, 'LOT-2024-003', 50, DATE_ADD(CURDATE(), INTERVAL 3 DAY), DATE_SUB(CURDATE(), INTERVAL 5 DAY), 'Local Farm Supply', 'Warehouse A - Cold Storage', 'Urgent - expiring soon')
ON DUPLICATE KEY UPDATE quantity=quantity;

-- Batches for PRD-002 (Rice - Basmati 5kg)
INSERT INTO batches (productId, lotCode, quantity, expiryDate, receivedDate, supplier, location, notes) VALUES
(2, 'LOT-2024-004', 300, DATE_ADD(CURDATE(), INTERVAL 365 DAY), DATE_SUB(CURDATE(), INTERVAL 10 DAY), 'Grain Distributors Ltd', 'Warehouse B - Shelf A1', 'Long shelf life'),
(2, 'LOT-2024-005', 250, DATE_ADD(CURDATE(), INTERVAL 400 DAY), DATE_SUB(CURDATE(), INTERVAL 5 DAY), 'Grain Distributors Ltd', 'Warehouse B - Shelf A2', 'Premium quality')
ON DUPLICATE KEY UPDATE quantity=quantity;

-- Batches for PRD-003 (Bread - White Loaf)
INSERT INTO batches (productId, lotCode, quantity, expiryDate, receivedDate, supplier, location, notes) VALUES
(3, 'LOT-2024-006', 80, DATE_ADD(CURDATE(), INTERVAL 2 DAY), CURDATE(), 'Bakery Fresh Inc', 'Warehouse A - Room Temp', 'Daily delivery'),
(3, 'LOT-2024-007', 60, DATE_ADD(CURDATE(), INTERVAL 1 DAY), DATE_SUB(CURDATE(), INTERVAL 1 DAY), 'Bakery Fresh Inc', 'Warehouse A - Room Temp', 'Expiring tomorrow')
ON DUPLICATE KEY UPDATE quantity=quantity;

-- Batches for PRD-004 (Yogurt - Greek)
INSERT INTO batches (productId, lotCode, quantity, expiryDate, receivedDate, supplier, location, notes) VALUES
(4, 'LOT-2024-008', 120, DATE_ADD(CURDATE(), INTERVAL 21 DAY), DATE_SUB(CURDATE(), INTERVAL 3 DAY), 'Dairy Products Co', 'Warehouse A - Cold Storage', 'Popular item'),
(4, 'LOT-2024-009', 90, DATE_ADD(CURDATE(), INTERVAL 18 DAY), DATE_SUB(CURDATE(), INTERVAL 2 DAY), 'Dairy Products Co', 'Warehouse A - Cold Storage', 'Regular stock')
ON DUPLICATE KEY UPDATE quantity=quantity;

-- Batches for PRD-005 (Coffee - Arabica Beans)
INSERT INTO batches (productId, lotCode, quantity, expiryDate, receivedDate, supplier, location, notes) VALUES
(5, 'LOT-2024-010', 200, DATE_ADD(CURDATE(), INTERVAL 730 DAY), DATE_SUB(CURDATE(), INTERVAL 15 DAY), 'Coffee Importers Inc', 'Warehouse B - Shelf B1', 'Premium arabica'),
(5, 'LOT-2024-011', 150, DATE_ADD(CURDATE(), INTERVAL 700 DAY), DATE_SUB(CURDATE(), INTERVAL 8 DAY), 'Coffee Importers Inc', 'Warehouse B - Shelf B1', 'Organic certified')
ON DUPLICATE KEY UPDATE quantity=quantity;

-- Batches for PRD-006 (Chicken Breast)
INSERT INTO batches (productId, lotCode, quantity, expiryDate, receivedDate, supplier, location, notes) VALUES
(6, 'LOT-2024-012', 100, DATE_ADD(CURDATE(), INTERVAL 5 DAY), DATE_SUB(CURDATE(), INTERVAL 1 DAY), 'Meat Suppliers Ltd', 'Warehouse A - Freezer', 'Frozen - keep frozen'),
(6, 'LOT-2024-013', 80, DATE_ADD(CURDATE(), INTERVAL 4 DAY), CURDATE(), 'Meat Suppliers Ltd', 'Warehouse A - Freezer', 'Fresh delivery')
ON DUPLICATE KEY UPDATE quantity=quantity;

-- Batches for PRD-007 (Tomatoes)
INSERT INTO batches (productId, lotCode, quantity, expiryDate, receivedDate, supplier, location, notes) VALUES
(7, 'LOT-2024-014', 150, DATE_ADD(CURDATE(), INTERVAL 7 DAY), DATE_SUB(CURDATE(), INTERVAL 2 DAY), 'Fresh Produce Co', 'Warehouse A - Room Temp', 'Ripe tomatoes'),
(7, 'LOT-2024-015', 100, DATE_ADD(CURDATE(), INTERVAL 5 DAY), DATE_SUB(CURDATE(), INTERVAL 1 DAY), 'Fresh Produce Co', 'Warehouse A - Room Temp', 'Local farm')
ON DUPLICATE KEY UPDATE quantity=quantity;

-- Batches for PRD-008 (Milk Powder)
INSERT INTO batches (productId, lotCode, quantity, expiryDate, receivedDate, supplier, location, notes) VALUES
(8, 'LOT-2024-016', 200, DATE_ADD(CURDATE(), INTERVAL 180 DAY), DATE_SUB(CURDATE(), INTERVAL 7 DAY), 'Dairy Powder Inc', 'Warehouse B - Shelf C1', 'Long shelf life'),
(8, 'LOT-2024-017', 150, DATE_ADD(CURDATE(), INTERVAL 200 DAY), DATE_SUB(CURDATE(), INTERVAL 3 DAY), 'Dairy Powder Inc', 'Warehouse B - Shelf C1', 'Bulk packaging')
ON DUPLICATE KEY UPDATE quantity=quantity;

-- Batches for PRD-009 (Cooking Oil)
INSERT INTO batches (productId, lotCode, quantity, expiryDate, receivedDate, supplier, location, notes) VALUES
(9, 'LOT-2024-018', 180, DATE_ADD(CURDATE(), INTERVAL 365 DAY), DATE_SUB(CURDATE(), INTERVAL 12 DAY), 'Oil Distributors', 'Warehouse B - Shelf D1', 'Vegetable oil'),
(9, 'LOT-2024-019', 120, DATE_ADD(CURDATE(), INTERVAL 400 DAY), DATE_SUB(CURDATE(), INTERVAL 5 DAY), 'Oil Distributors', 'Warehouse B - Shelf D1', 'Premium quality')
ON DUPLICATE KEY UPDATE quantity=quantity;

-- Batches for PRD-010 (Sugar)
INSERT INTO batches (productId, lotCode, quantity, expiryDate, receivedDate, supplier, location, notes) VALUES
(10, 'LOT-2024-020', 250, DATE_ADD(CURDATE(), INTERVAL 730 DAY), DATE_SUB(CURDATE(), INTERVAL 20 DAY), 'Sugar Mills Ltd', 'Warehouse B - Shelf E1', 'White refined sugar'),
(10, 'LOT-2024-021', 200, DATE_ADD(CURDATE(), INTERVAL 800 DAY), DATE_SUB(CURDATE(), INTERVAL 10 DAY), 'Sugar Mills Ltd', 'Warehouse B - Shelf E1', 'Bulk order')
ON DUPLICATE KEY UPDATE quantity=quantity;

-- Batches for PRD-011 (Flour)
INSERT INTO batches (productId, lotCode, quantity, expiryDate, receivedDate, supplier, location, notes) VALUES
(11, 'LOT-2024-022', 180, DATE_ADD(CURDATE(), INTERVAL 180 DAY), DATE_SUB(CURDATE(), INTERVAL 8 DAY), 'Flour Mill Co', 'Warehouse B - Shelf F1', 'All-purpose flour'),
(11, 'LOT-2024-023', 120, DATE_ADD(CURDATE(), INTERVAL 200 DAY), DATE_SUB(CURDATE(), INTERVAL 4 DAY), 'Flour Mill Co', 'Warehouse B - Shelf F1', 'Premium grade')
ON DUPLICATE KEY UPDATE quantity=quantity;

-- Batches for PRD-012 (Eggs)
INSERT INTO batches (productId, lotCode, quantity, expiryDate, receivedDate, supplier, location, notes) VALUES
(12, 'LOT-2024-024', 150, DATE_ADD(CURDATE(), INTERVAL 30 DAY), DATE_SUB(CURDATE(), INTERVAL 1 DAY), 'Egg Farm Fresh', 'Warehouse A - Cold Storage', 'Grade A large eggs'),
(12, 'LOT-2024-025', 100, DATE_ADD(CURDATE(), INTERVAL 25 DAY), CURDATE(), 'Egg Farm Fresh', 'Warehouse A - Cold Storage', 'Fresh delivery')
ON DUPLICATE KEY UPDATE quantity=quantity;

-- Batches for PRD-013 (Onions)
INSERT INTO batches (productId, lotCode, quantity, expiryDate, receivedDate, supplier, location, notes) VALUES
(13, 'LOT-2024-026', 120, DATE_ADD(CURDATE(), INTERVAL 60 DAY), DATE_SUB(CURDATE(), INTERVAL 3 DAY), 'Vegetable Growers', 'Warehouse A - Room Temp', 'Yellow onions'),
(13, 'LOT-2024-027', 80, DATE_ADD(CURDATE(), INTERVAL 45 DAY), DATE_SUB(CURDATE(), INTERVAL 1 DAY), 'Vegetable Growers', 'Warehouse A - Room Temp', 'Local produce')
ON DUPLICATE KEY UPDATE quantity=quantity;

-- Batches for PRD-014 (Potatoes)
INSERT INTO batches (productId, lotCode, quantity, expiryDate, receivedDate, supplier, location, notes) VALUES
(14, 'LOT-2024-028', 200, DATE_ADD(CURDATE(), INTERVAL 90 DAY), DATE_SUB(CURDATE(), INTERVAL 5 DAY), 'Potato Farm Co', 'Warehouse A - Room Temp', 'Russet potatoes'),
(14, 'LOT-2024-029', 150, DATE_ADD(CURDATE(), INTERVAL 85 DAY), DATE_SUB(CURDATE(), INTERVAL 2 DAY), 'Potato Farm Co', 'Warehouse A - Room Temp', 'Fresh harvest')
ON DUPLICATE KEY UPDATE quantity=quantity;

-- Batches for PRD-015 (Pasta)
INSERT INTO batches (productId, lotCode, quantity, expiryDate, receivedDate, supplier, location, notes) VALUES
(15, 'LOT-2024-030', 300, DATE_ADD(CURDATE(), INTERVAL 730 DAY), DATE_SUB(CURDATE(), INTERVAL 15 DAY), 'Pasta Manufacturers', 'Warehouse B - Shelf G1', 'Spaghetti 500g packs'),
(15, 'LOT-2024-031', 250, DATE_ADD(CURDATE(), INTERVAL 800 DAY), DATE_SUB(CURDATE(), INTERVAL 7 DAY), 'Pasta Manufacturers', 'Warehouse B - Shelf G1', 'Premium pasta')
ON DUPLICATE KEY UPDATE quantity=quantity;

-- ============================================
-- UPDATE INVENTORY ITEMS BASED ON BATCHES
-- ============================================
-- This will create/update inventory_items based on the batches we just created

-- Delete existing inventory items to recalculate
DELETE FROM inventory_items;

-- Insert inventory items based on batches (sum quantities per product)
INSERT INTO inventory_items (productId, totalQty, available, reserved, location)
SELECT 
    b.productId,
    SUM(b.quantity) as totalQty,
    SUM(b.quantity) as available,
    0 as reserved,
    MAX(b.location) as location
FROM batches b
GROUP BY b.productId;

-- ============================================
-- CREATE SAMPLE IN_RECORDS (Receiving Records)
-- ============================================
-- Link batches to receiving records

INSERT INTO in_records (recordNumber, productId, batchId, quantity, supplier, receivedBy, receivedDate, notes)
SELECT 
    CONCAT('IN-', LPAD(b.batchId, 6, '0')) as recordNumber,
    b.productId,
    b.batchId,
    b.quantity,
    b.supplier,
    1 as receivedBy, -- Assuming user ID 1 exists (admin)
    b.receivedDate,
    b.notes
FROM batches b
WHERE NOT EXISTS (
    SELECT 1 FROM in_records ir WHERE ir.batchId = b.batchId
);

-- ============================================
-- SUCCESS MESSAGE
-- ============================================
SELECT 
    'Sample data populated successfully! ✅' AS message,
    (SELECT COUNT(*) FROM batches) AS total_batches,
    (SELECT COUNT(*) FROM products) AS total_products,
    (SELECT COUNT(*) FROM inventory_items) AS total_inventory_items,
    (SELECT SUM(totalQty) FROM inventory_items) AS total_quantity;





