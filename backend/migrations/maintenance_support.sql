-- ============================================
-- SWMS Maintenance Support Migration
-- Run after setup.sql and enhancements.sql
-- mysql -u root -p swms_db < migrations/maintenance_support.sql
-- ============================================
-- Supports products that include maintenance service (equipment, warranty, service plans)

USE swms_db;

-- ============================================
-- 1. PRODUCTS - Add product type and maintenance fields
-- ============================================
ALTER TABLE products ADD COLUMN IF NOT EXISTS productType ENUM('GOODS', 'EQUIPMENT', 'SERVICE', 'GOODS_WITH_SERVICE') DEFAULT 'GOODS' AFTER category;
ALTER TABLE products ADD COLUMN IF NOT EXISTS warrantyMonths INT NULL AFTER minStock;
ALTER TABLE products ADD COLUMN IF NOT EXISTS maintenanceIntervalMonths INT NULL AFTER warrantyMonths;

-- ============================================
-- 2. BATCHES - Add maintenance-related dates
-- ============================================
ALTER TABLE batches ADD COLUMN IF NOT EXISTS installationDate DATE NULL AFTER receivedDate;
ALTER TABLE batches ADD COLUMN IF NOT EXISTS warrantyExpiry DATE NULL AFTER installationDate;
ALTER TABLE batches ADD COLUMN IF NOT EXISTS nextMaintenanceDue DATE NULL AFTER warrantyExpiry;
ALTER TABLE batches ADD COLUMN IF NOT EXISTS lastMaintenanceDate DATE NULL AFTER nextMaintenanceDue;

-- ============================================
-- 3. ALERTS - Add MAINTENANCE_DUE and WARRANTY_EXPIRING
-- ============================================
ALTER TABLE alerts 
MODIFY COLUMN alertType ENUM('LOW_STOCK', 'NEAR_EXPIRY', 'EXPIRED', 'MAINTENANCE_DUE', 'WARRANTY_EXPIRING') NOT NULL;

-- ============================================
-- 4. Add Equipment category and sample product
-- ============================================
INSERT INTO products (sku, name, category, unit, minStock, productType, warrantyMonths, maintenanceIntervalMonths) 
SELECT 'PRD-EQP-001', 'Industrial Forklift - Model X', 'Equipment', 'unit', 0, 'EQUIPMENT', 12, 6
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM products WHERE sku = 'PRD-EQP-001' LIMIT 1);

SELECT 'Maintenance support migration completed!' AS message;
