-- Add suppliers table (run this if your database already exists)
-- Run in phpMyAdmin or: mysql -u root -proot swms_db < add_suppliers_table.sql

USE swms_db;

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

SELECT 'Suppliers table created successfully!' AS message;
