-- ============================================
-- SWMS FULL DATABASE SETUP FOR RAILWAY
-- ============================================
-- Paste this entire file into Railway's MySQL Query editor
-- Or run: mysql -h caboose.proxy.rlwy.net -P 51376 -u root -p railway < railway_full_setup.sql
-- ============================================

USE railway;

-- ============================================
-- 1. USERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS users (
    userId INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    passwordHash VARCHAR(255) NOT NULL,
    role ENUM('ADMIN', 'STAFF') DEFAULT 'STAFF',
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_email (email),
    INDEX idx_role (role)
);

-- ============================================
-- 2. PRODUCTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS products (
    productId INT PRIMARY KEY AUTO_INCREMENT,
    sku VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100),
    unit VARCHAR(50) DEFAULT 'unit',
    minStock INT DEFAULT 0,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_sku (sku),
    INDEX idx_category (category)
);

-- ============================================
-- 3. INVENTORY ITEMS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS inventory_items (
    inventoryId INT PRIMARY KEY AUTO_INCREMENT,
    productId INT NOT NULL,
    totalQty INT DEFAULT 0,
    available INT DEFAULT 0,
    reserved INT DEFAULT 0,
    location VARCHAR(255),
    FOREIGN KEY (productId) REFERENCES products(productId) ON DELETE CASCADE,
    UNIQUE KEY unique_product (productId),
    INDEX idx_product (productId)
);

-- ============================================
-- 4. BATCHES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS batches (
    batchId INT PRIMARY KEY AUTO_INCREMENT,
    productId INT NOT NULL,
    lotCode VARCHAR(100) UNIQUE NOT NULL,
    quantity INT NOT NULL,
    expiryDate DATE,
    receivedDate DATE DEFAULT (CURRENT_DATE),
    supplier VARCHAR(255),
    location VARCHAR(255) NULL,
    notes TEXT NULL,
    FOREIGN KEY (productId) REFERENCES products(productId) ON DELETE CASCADE,
    INDEX idx_product (productId),
    INDEX idx_lot_code (lotCode),
    INDEX idx_expiry (expiryDate)
);

-- ============================================
-- 5. IN RECORDS TABLE (Stock Receiving)
-- ============================================
CREATE TABLE IF NOT EXISTS in_records (
    recordId INT PRIMARY KEY AUTO_INCREMENT,
    recordNumber VARCHAR(50) UNIQUE NOT NULL,
    productId INT NOT NULL,
    batchId INT,
    quantity INT NOT NULL,
    supplier VARCHAR(255),
    receivedBy INT,
    receivedDate DATE DEFAULT (CURRENT_DATE),
    notes TEXT,
    FOREIGN KEY (productId) REFERENCES products(productId),
    FOREIGN KEY (batchId) REFERENCES batches(batchId),
    FOREIGN KEY (receivedBy) REFERENCES users(userId),
    INDEX idx_record_number (recordNumber),
    INDEX idx_received_date (receivedDate)
);

-- ============================================
-- 6. OUT RECORDS TABLE (Stock Issuing)
-- ============================================
CREATE TABLE IF NOT EXISTS out_records (
    recordId INT PRIMARY KEY AUTO_INCREMENT,
    recordNumber VARCHAR(50) UNIQUE NOT NULL,
    productId INT NOT NULL,
    batchId INT,
    quantity INT NOT NULL,
    recipient VARCHAR(255),
    issuedBy INT,
    issuedDate DATE DEFAULT (CURRENT_DATE),
    notes TEXT,
    FOREIGN KEY (productId) REFERENCES products(productId),
    FOREIGN KEY (batchId) REFERENCES batches(batchId),
    FOREIGN KEY (issuedBy) REFERENCES users(userId),
    INDEX idx_record_number (recordNumber),
    INDEX idx_issued_date (issuedDate)
);

-- ============================================
-- 7. BOOKINGS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS bookings (
    bookingId INT PRIMARY KEY AUTO_INCREMENT,
    bookingNumber VARCHAR(50) UNIQUE NOT NULL,
    productId INT NOT NULL,
    quantity INT NOT NULL,
    requestedBy INT NOT NULL,
    requestedDate DATE DEFAULT (CURRENT_DATE),
    neededBy DATE,
    status ENUM('PENDING', 'APPROVED', 'CANCELLED', 'FULFILLED') DEFAULT 'PENDING',
    approvedBy INT,
    approvedDate DATE,
    rejectReason TEXT NULL,
    notes TEXT,
    FOREIGN KEY (productId) REFERENCES products(productId),
    FOREIGN KEY (requestedBy) REFERENCES users(userId),
    FOREIGN KEY (approvedBy) REFERENCES users(userId),
    INDEX idx_booking_number (bookingNumber),
    INDEX idx_status (status),
    INDEX idx_requested_by (requestedBy)
);

-- ============================================
-- 8. ALERTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS alerts (
    alertId INT PRIMARY KEY AUTO_INCREMENT,
    alertType ENUM('LOW_STOCK', 'NEAR_EXPIRY', 'EXPIRED') NOT NULL,
    severity ENUM('INFO', 'WARN', 'CRITICAL') DEFAULT 'WARN',
    productId INT,
    batchId INT,
    message TEXT NOT NULL,
    resolved BOOLEAN DEFAULT FALSE,
    resolvedBy INT,
    resolvedAt TIMESTAMP NULL,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (productId) REFERENCES products(productId) ON DELETE CASCADE,
    FOREIGN KEY (batchId) REFERENCES batches(batchId) ON DELETE CASCADE,
    FOREIGN KEY (resolvedBy) REFERENCES users(userId),
    INDEX idx_alert_type (alertType),
    INDEX idx_resolved (resolved),
    INDEX idx_created (createdAt)
);

-- ============================================
-- 9. NOTIFICATIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS notifications (
    notificationId INT PRIMARY KEY AUTO_INCREMENT,
    userId INT NOT NULL,
    message TEXT NOT NULL,
    recipient VARCHAR(255) NOT NULL,
    notificationType VARCHAR(50) DEFAULT 'INFO',
    relatedEntityType VARCHAR(50) NULL,
    relatedEntityId INT NULL,
    isRead BOOLEAN DEFAULT FALSE,
    readAt TIMESTAMP NULL,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (userId) REFERENCES users(userId) ON DELETE CASCADE,
    INDEX idx_user (userId),
    INDEX idx_recipient (recipient),
    INDEX idx_read (isRead),
    INDEX idx_created (createdAt),
    INDEX idx_user_read (userId, isRead)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- SAMPLE DATA
-- ============================================

-- Users (password: "password" for both - bcrypt hash)
INSERT INTO users (name, email, passwordHash, role) VALUES
('Admin User', 'admin@swms.com', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'ADMIN'),
('Staff User', 'staff@swms.com', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'STAFF')
ON DUPLICATE KEY UPDATE name=name;

-- Products
INSERT INTO products (sku, name, category, unit, minStock) VALUES
('PRD-001', 'Milk - Fresh Whole', 'Dairy', 'liter', 50),
('PRD-002', 'Rice - Basmati 5kg', 'Grains', 'bag', 100),
('PRD-003', 'Bread - White Loaf', 'Bakery', 'loaf', 40),
('PRD-004', 'Yogurt - Greek', 'Dairy', 'unit', 80),
('PRD-005', 'Coffee - Arabica Beans', 'Beverages', 'kg', 150),
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

-- Batches
INSERT INTO batches (productId, lotCode, quantity, expiryDate, receivedDate, supplier, location, notes) VALUES
(1, 'LOT-2024-001', 150, DATE_ADD(CURDATE(), INTERVAL 7 DAY), DATE_SUB(CURDATE(), INTERVAL 2 DAY), 'Fresh Dairy Co.', 'Warehouse A - Cold Storage', 'Fresh delivery'),
(1, 'LOT-2024-002', 200, DATE_ADD(CURDATE(), INTERVAL 14 DAY), DATE_SUB(CURDATE(), INTERVAL 1 DAY), 'Fresh Dairy Co.', 'Warehouse A - Cold Storage', 'Bulk order'),
(2, 'LOT-2024-004', 300, DATE_ADD(CURDATE(), INTERVAL 365 DAY), DATE_SUB(CURDATE(), INTERVAL 10 DAY), 'Grain Distributors Ltd', 'Warehouse B - Shelf A1', 'Long shelf life'),
(3, 'LOT-2024-006', 80, DATE_ADD(CURDATE(), INTERVAL 2 DAY), CURDATE(), 'Bakery Fresh Inc', 'Warehouse A - Room Temp', 'Daily delivery'),
(4, 'LOT-2024-008', 120, DATE_ADD(CURDATE(), INTERVAL 21 DAY), DATE_SUB(CURDATE(), INTERVAL 3 DAY), 'Dairy Products Co', 'Warehouse A - Cold Storage', 'Popular item'),
(5, 'LOT-2024-010', 200, DATE_ADD(CURDATE(), INTERVAL 730 DAY), DATE_SUB(CURDATE(), INTERVAL 15 DAY), 'Coffee Importers Inc', 'Warehouse B - Shelf B1', 'Premium arabica')
ON DUPLICATE KEY UPDATE quantity=quantity;

-- Inventory items (from batches)
INSERT INTO inventory_items (productId, totalQty, available, reserved, location)
SELECT productId, SUM(quantity) as totalQty, SUM(quantity) as available, 0 as reserved, MAX(location) as location
FROM batches GROUP BY productId
ON DUPLICATE KEY UPDATE totalQty=VALUES(totalQty), available=VALUES(available), location=VALUES(location);

-- In records (receiving records)
INSERT INTO in_records (recordNumber, productId, batchId, quantity, supplier, receivedBy, receivedDate, notes)
SELECT CONCAT('IN-', LPAD(batchId, 6, '0')), productId, batchId, quantity, supplier, 1, receivedDate, notes
FROM batches
WHERE NOT EXISTS (SELECT 1 FROM in_records ir WHERE ir.batchId = batches.batchId);

-- Done
SELECT 'Database setup completed successfully!' AS message;
