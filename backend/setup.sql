-- ============================================
-- SWMS Database Setup Script
-- ============================================
-- Run this script in MySQL to create your database
-- 
-- Instructions:
-- 1. Open MySQL command line or phpMyAdmin
-- 2. Run: source setup.sql;  (or copy-paste this entire file)
--
-- Aiven (defaultdb): you usually cannot CREATE DATABASE. In the Aiven SQL editor
-- or mysql client, select database `defaultdb`, then comment out the CREATE line
-- below and use:  USE defaultdb;
-- ============================================

-- Create database
CREATE DATABASE IF NOT EXISTS swms_db;
USE swms_db;

-- ============================================
-- USERS TABLE
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
-- PRODUCTS TABLE
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
-- INVENTORY ITEMS TABLE
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
-- BATCHES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS batches (
    batchId INT PRIMARY KEY AUTO_INCREMENT,
    productId INT NOT NULL,
    lotCode VARCHAR(100) UNIQUE NOT NULL,
    quantity INT NOT NULL,
    expiryDate DATE,
    receivedDate DATE DEFAULT (CURRENT_DATE),
    supplier VARCHAR(255),
    FOREIGN KEY (productId) REFERENCES products(productId) ON DELETE CASCADE,
    INDEX idx_product (productId),
    INDEX idx_lot_code (lotCode),
    INDEX idx_expiry (expiryDate)
);

-- ============================================
-- IN RECORDS TABLE (Stock Receiving)
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
-- OUT RECORDS TABLE (Stock Issuing)
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
-- BOOKINGS TABLE
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
-- SUPPLIERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS suppliers (
    supplierId INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    contactPerson VARCHAR(255),
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(50),
    address TEXT,
    status ENUM('active', 'inactive') DEFAULT 'active',
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_email (email),
    INDEX idx_status (status)
);

-- ============================================
-- REFRESH TOKENS TABLE (for JWT refresh)
-- ============================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
    tokenId INT PRIMARY KEY AUTO_INCREMENT,
    userId INT NOT NULL,
    token VARCHAR(500) NOT NULL,
    expiresAt TIMESTAMP NOT NULL,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (userId) REFERENCES users(userId) ON DELETE CASCADE,
    INDEX idx_token (token(255)),
    INDEX idx_user (userId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- ALERTS TABLE
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
-- NOTIFICATIONS TABLE
-- ============================================
-- Message Box persistence: isRead + createdAt
CREATE TABLE IF NOT EXISTS notifications (
    notificationId INT PRIMARY KEY AUTO_INCREMENT,
    userId INT NOT NULL, -- recipient userId
    type ENUM('Alert', 'Request', 'Result') NOT NULL DEFAULT 'Request',
    notificationType ENUM('INFO', 'WARNING', 'SUCCESS') DEFAULT 'INFO',
    message TEXT NOT NULL,
    recipient VARCHAR(255) NOT NULL DEFAULT 'Unknown', -- display name snapshot
    relatedEntityType VARCHAR(255) NULL,
    relatedEntityId INT NULL,
    rejectionReason TEXT NULL,
    isRead BOOLEAN DEFAULT FALSE,
    readAt TIMESTAMP NULL,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (userId) REFERENCES users(userId) ON DELETE CASCADE,
    INDEX idx_notifications_user (userId),
    INDEX idx_notifications_type (type),
    INDEX idx_notifications_isRead (isRead),
    INDEX idx_notifications_createdAt (createdAt)
);

-- ============================================
-- SAMPLE DATA (Optional - for testing)
-- ============================================

-- Insert sample admin and staff users (password: password)
INSERT INTO users (name, email, passwordHash, role) VALUES
('Admin User', 'admin@swms.com', '$2a$10$qme7wpAGTA8OmM8o9cRoS.bZyqzjNkGIHpfcVi2/9.dXfVvrGwW7.', 'ADMIN'),
('Staff User', 'staff@swms.com', '$2a$10$AwqgPNr9CNsWFTH79QDSMeymmcb7vRHEKCsabSsig372dmDNj1Xtu', 'STAFF')
ON DUPLICATE KEY UPDATE name=name;

-- Insert sample products
INSERT INTO products (sku, name, category, unit, minStock) VALUES
('PRD-001', 'Milk - Fresh Whole', 'Dairy', 'liter', 50),
('PRD-002', 'Rice - Basmati 5kg', 'Grains', 'bag', 100),
('PRD-003', 'Bread - White Loaf', 'Bakery', 'loaf', 40),
('PRD-004', 'Yogurt - Greek', 'Dairy', 'unit', 80),
('PRD-005', 'Coffee - Arabica Beans', 'Beverages', 'kg', 150)
ON DUPLICATE KEY UPDATE name=name;

-- Insert sample suppliers
INSERT IGNORE INTO suppliers (name, contactPerson, email, phone, address, status) VALUES
('Fresh Farm Co.', 'John Smith', 'john@freshfarm.com', '+1 555-0101', '123 Farm Road, Green Valley', 'active'),
('Quality Dairy Ltd', 'Jane Doe', 'jane@qualitydairy.com', '+1 555-0102', '456 Milk Street, Dairy Town', 'active'),
('Grain Masters Inc', 'Bob Wilson', 'bob@grainmasters.com', '+1 555-0103', '789 Harvest Ave, Grain City', 'active');

-- ============================================
-- SUPPLIER_PRODUCTS TABLE (offerings)
-- ============================================
CREATE TABLE IF NOT EXISTS supplier_products (
    supplierId INT NOT NULL,
    productId INT NOT NULL,
    PRIMARY KEY (supplierId, productId),
    FOREIGN KEY (supplierId) REFERENCES suppliers(supplierId) ON DELETE CASCADE,
    FOREIGN KEY (productId) REFERENCES products(productId) ON DELETE CASCADE,
    INDEX idx_supplier (supplierId),
    INDEX idx_product (productId)
);

-- Add notes column to suppliers (if not exists)
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'suppliers' AND COLUMN_NAME = 'notes');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE suppliers ADD COLUMN notes TEXT NULL', 'SELECT 1 AS ok');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Insert sample supplier offerings (link suppliers to products)
INSERT IGNORE INTO supplier_products (supplierId, productId)
SELECT s.supplierId, p.productId FROM suppliers s
CROSS JOIN products p
WHERE p.sku IN ('PRD-001', 'PRD-002', 'PRD-003', 'PRD-004', 'PRD-005')
AND (
    (s.email = 'john@freshfarm.com' AND p.sku IN ('PRD-001', 'PRD-002', 'PRD-003'))
    OR (s.email = 'jane@qualitydairy.com' AND p.sku IN ('PRD-001', 'PRD-004'))
    OR (s.email = 'bob@grainmasters.com' AND p.sku IN ('PRD-002', 'PRD-005'))
);

-- ============================================
-- SUCCESS MESSAGE
-- ============================================
SELECT 'Database setup completed successfully! ✅' AS message;

