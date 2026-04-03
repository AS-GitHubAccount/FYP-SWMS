-- ============================================
-- NOTIFICATIONS TABLE
-- ============================================
-- This creates a notifications table for user notifications
-- Run this to enable notifications in the database
-- 
-- Instructions:
-- mysql -u root -h 127.0.0.1 -P 3306 swms_db < create_notifications_table.sql
-- ============================================

USE swms_db;

-- ============================================
-- CREATE NOTIFICATIONS TABLE
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
-- SUCCESS MESSAGE
-- ============================================
SELECT 'Notifications table created successfully! ✅' AS message;




