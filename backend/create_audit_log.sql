-- ============================================
-- AUDIT LOG SYSTEM
-- ============================================
-- This creates an audit log table to automatically track all changes
-- Run this to enable automatic change tracking
-- 
-- Instructions:
-- mysql -u root -h 127.0.0.1 -P 3306 swms_db < create_audit_log.sql
-- ============================================

USE swms_db;

-- ============================================
-- CREATE AUDIT LOG TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS audit_log (
    auditId INT PRIMARY KEY AUTO_INCREMENT,
    tableName VARCHAR(100) NOT NULL,
    recordId INT NOT NULL,
    action ENUM('INSERT', 'UPDATE', 'DELETE') NOT NULL,
    userId INT,
    userName VARCHAR(255),
    oldValues JSON,
    newValues JSON,
    changedFields TEXT,
    ipAddress VARCHAR(45),
    userAgent TEXT,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_table_record (tableName, recordId),
    INDEX idx_user (userId),
    INDEX idx_action (action),
    INDEX idx_created (createdAt),
    INDEX idx_table_created (tableName, createdAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- SUCCESS MESSAGE
-- ============================================
SELECT 'Audit log table created successfully! ✅' AS message;





