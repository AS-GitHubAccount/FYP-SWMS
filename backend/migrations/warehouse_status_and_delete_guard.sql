-- Warehouse status column and delete-guard links
-- Ensures: status (Active/Inactive), and warehouseId on transaction tables for safe-delete check.
-- Run once: mysql ... < backend/migrations/warehouse_status_and_delete_guard.sql

-- 1. Add status to warehouses if not present (VARCHAR, default 'Active')
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'warehouses' AND COLUMN_NAME = 'status'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE warehouses ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT ''Active''',
  'SELECT ''warehouses.status already exists'' AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- (Optional) Backfill: UPDATE warehouses SET status = IF(isActive = 1, 'Active', 'Inactive'); run if isActive exists.

-- 2. Add warehouseId to in_records for traceability / delete guard (optional link)
SET @col_ir = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'in_records' AND COLUMN_NAME = 'warehouseId'
);
SET @sql_ir = IF(@col_ir = 0,
  'ALTER TABLE in_records ADD COLUMN warehouseId INT NULL',
  'SELECT ''in_records.warehouseId already exists'' AS msg'
);
PREPARE stmt_ir FROM @sql_ir;
EXECUTE stmt_ir;
DEALLOCATE PREPARE stmt_ir;

-- 3. Add warehouseId to out_records for traceability / delete guard (optional link)
SET @col_or = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'out_records' AND COLUMN_NAME = 'warehouseId'
);
SET @sql_or = IF(@col_or = 0,
  'ALTER TABLE out_records ADD COLUMN warehouseId INT NULL',
  'SELECT ''out_records.warehouseId already exists'' AS msg'
);
PREPARE stmt_or FROM @sql_or;
EXECUTE stmt_or;
DEALLOCATE PREPARE stmt_or;

SELECT 'Warehouse status and delete-guard migration completed.' AS message;
