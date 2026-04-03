-- ============================================
-- SWMS Enhancements Migration
-- Run after setup.sql
-- mysql -u root -p swms_db < migrations/enhancements.sql
-- ============================================

USE swms_db;

-- ============================================
-- 1. PURCHASE_REQUESTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS purchase_requests (
    requestId INT PRIMARY KEY AUTO_INCREMENT,
    requestNumber VARCHAR(50) UNIQUE NOT NULL,
    productId INT NOT NULL,
    quantity INT NOT NULL,
    supplierId INT NULL,
    priority ENUM('low','medium','high','urgent') DEFAULT 'medium',
    neededBy DATE,
    sendingLocation VARCHAR(255) NULL,
    requestedBy INT NOT NULL,
    requestedDate DATE DEFAULT (CURRENT_DATE),
    status ENUM('PENDING','APPROVED','REJECTED') DEFAULT 'PENDING',
    approvedBy INT NULL,
    approvedDate DATE NULL,
    rejectedBy INT NULL,
    rejectedDate DATE NULL,
    rejectReason TEXT NULL,
    notes TEXT,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (productId) REFERENCES products(productId) ON DELETE CASCADE,
    FOREIGN KEY (requestedBy) REFERENCES users(userId),
    FOREIGN KEY (approvedBy) REFERENCES users(userId),
    FOREIGN KEY (rejectedBy) REFERENCES users(userId),
    FOREIGN KEY (supplierId) REFERENCES suppliers(supplierId),
    INDEX idx_status (status),
    INDEX idx_requested_by (requestedBy)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- 2. DISPOSAL_REQUESTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS disposal_requests (
    disposalId INT PRIMARY KEY AUTO_INCREMENT,
    requestNumber VARCHAR(50) UNIQUE NOT NULL,
    batchId INT NOT NULL,
    productId INT NOT NULL,
    requestedBy INT NOT NULL,
    requestedDate DATE DEFAULT (CURRENT_DATE),
    status ENUM('PENDING','APPROVED','REJECTED','COMPLETED') DEFAULT 'PENDING',
    approvedBy INT NULL,
    approvedDate DATE NULL,
    rejectedBy INT NULL,
    rejectedDate DATE NULL,
    rejectReason TEXT NULL,
    completedBy INT NULL,
    completedDate DATE NULL,
    notes TEXT,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (batchId) REFERENCES batches(batchId) ON DELETE CASCADE,
    FOREIGN KEY (productId) REFERENCES products(productId),
    FOREIGN KEY (requestedBy) REFERENCES users(userId),
    FOREIGN KEY (approvedBy) REFERENCES users(userId),
    FOREIGN KEY (rejectedBy) REFERENCES users(userId),
    FOREIGN KEY (completedBy) REFERENCES users(userId),
    INDEX idx_status (status),
    INDEX idx_batch (batchId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- 3. BOOKINGS - ADD rejectReason
-- ============================================
-- Run: ALTER TABLE bookings ADD COLUMN rejectReason TEXT NULL;
-- Ignore error if column already exists

-- ============================================
-- 10. STOCK_ADJUSTMENTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS stock_adjustments (
    adjustmentId INT PRIMARY KEY AUTO_INCREMENT,
    productId INT NOT NULL,
    batchId INT NULL,
    adjustmentType ENUM('CORRECTION','DAMAGE','WRITEOFF','TRANSFER') NOT NULL,
    quantity INT NOT NULL,
    reason TEXT,
    adjustedBy INT NOT NULL,
    adjustedDate DATE DEFAULT (CURRENT_DATE),
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (productId) REFERENCES products(productId),
    FOREIGN KEY (batchId) REFERENCES batches(batchId),
    FOREIGN KEY (adjustedBy) REFERENCES users(userId),
    INDEX idx_product (productId),
    INDEX idx_adjusted_date (adjustedDate)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- 11. PRODUCTS - ADD supplierId (run if not exists)
-- ============================================
-- ALTER TABLE products ADD COLUMN supplierId INT NULL;
-- ALTER TABLE products ADD FOREIGN KEY (supplierId) REFERENCES suppliers(supplierId) ON DELETE SET NULL;

-- ============================================
-- 24. WAREHOUSES TABLE (Multi-warehouse)
-- ============================================
CREATE TABLE IF NOT EXISTS warehouses (
    warehouseId INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    address TEXT,
    isActive BOOLEAN DEFAULT TRUE,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Add warehouseId to inventory_items (run if not exists)
-- ALTER TABLE inventory_items ADD COLUMN warehouseId INT NULL;
-- ALTER TABLE inventory_items ADD FOREIGN KEY (warehouseId) REFERENCES warehouses(warehouseId) ON DELETE SET NULL;

-- Insert default warehouse if none exists
INSERT INTO warehouses (name, code, address)
SELECT 'Main Warehouse', 'MAIN', 'Default location'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM warehouses LIMIT 1);

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

SELECT 'Enhancements migration completed!' AS message;
