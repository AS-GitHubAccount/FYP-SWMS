-- ============================================
-- RFQ Process Migration
-- Run after setup.sql and enhancements.sql
-- Enables: PR → RFQ → Quotations → PO flow
-- ============================================

USE swms_db;

-- ============================================
-- 1. RFQs TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS rfqs (
    rfqId INT PRIMARY KEY AUTO_INCREMENT,
    rfqNumber VARCHAR(50) UNIQUE NOT NULL,
    purchaseRequestId INT NOT NULL,
    status ENUM('DRAFT','SENT','QUOTES_RECEIVED','AWARDED','CLOSED') DEFAULT 'DRAFT',
    quoteDueDate DATE,
    notes TEXT,
    createdBy INT,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (purchaseRequestId) REFERENCES purchase_requests(requestId) ON DELETE CASCADE,
    FOREIGN KEY (createdBy) REFERENCES users(userId),
    INDEX idx_status (status),
    INDEX idx_pr (purchaseRequestId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- 2. RFQ_SUPPLIERS TABLE (which suppliers received the RFQ)
-- ============================================
CREATE TABLE IF NOT EXISTS rfq_suppliers (
    id INT PRIMARY KEY AUTO_INCREMENT,
    rfqId INT NOT NULL,
    supplierId INT NOT NULL,
    status ENUM('SENT','QUOTED','DECLINED') DEFAULT 'SENT',
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (rfqId) REFERENCES rfqs(rfqId) ON DELETE CASCADE,
    FOREIGN KEY (supplierId) REFERENCES suppliers(supplierId) ON DELETE CASCADE,
    UNIQUE KEY unique_rfq_supplier (rfqId, supplierId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- 3. QUOTATIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS quotations (
    quotationId INT PRIMARY KEY AUTO_INCREMENT,
    rfqId INT NOT NULL,
    supplierId INT NOT NULL,
    unitPrice DECIMAL(10,2) NOT NULL,
    totalAmount DECIMAL(12,2) NOT NULL,
    deliveryDate DATE,
    validUntil DATE,
    currency VARCHAR(3) DEFAULT 'USD',
    notes TEXT,
    status ENUM('SUBMITTED','ACCEPTED','REJECTED') DEFAULT 'SUBMITTED',
    submittedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    createdBy INT,
    FOREIGN KEY (rfqId) REFERENCES rfqs(rfqId) ON DELETE CASCADE,
    FOREIGN KEY (supplierId) REFERENCES suppliers(supplierId) ON DELETE CASCADE,
    FOREIGN KEY (createdBy) REFERENCES users(userId),
    UNIQUE KEY unique_rfq_supplier_quote (rfqId, supplierId),
    INDEX idx_rfq (rfqId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- 4. PURCHASE_ORDERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS purchase_orders (
    poId INT PRIMARY KEY AUTO_INCREMENT,
    poNumber VARCHAR(50) UNIQUE NOT NULL,
    quotationId INT,
    rfqId INT,
    purchaseRequestId INT,
    supplierId INT NOT NULL,
    productId INT NOT NULL,
    quantity INT NOT NULL,
    unitPrice DECIMAL(10,2) NOT NULL,
    totalAmount DECIMAL(12,2) NOT NULL,
    status ENUM('DRAFT','SENT','CONFIRMED','PARTIAL_RECEIVED','RECEIVED','CANCELLED') DEFAULT 'DRAFT',
    orderDate DATE DEFAULT (CURRENT_DATE),
    expectedDelivery DATE,
    createdBy INT,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (quotationId) REFERENCES quotations(quotationId) ON DELETE SET NULL,
    FOREIGN KEY (rfqId) REFERENCES rfqs(rfqId) ON DELETE SET NULL,
    FOREIGN KEY (purchaseRequestId) REFERENCES purchase_requests(requestId) ON DELETE SET NULL,
    FOREIGN KEY (supplierId) REFERENCES suppliers(supplierId),
    FOREIGN KEY (productId) REFERENCES products(productId),
    FOREIGN KEY (createdBy) REFERENCES users(userId),
    INDEX idx_status (status),
    INDEX idx_supplier (supplierId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SELECT 'RFQ process migration completed!' AS message;
