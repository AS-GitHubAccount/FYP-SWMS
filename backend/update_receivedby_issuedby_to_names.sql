-- ============================================
-- Update receivedBy and issuedBy to Store Names
-- ============================================
-- This script changes receivedBy and issuedBy columns
-- from user IDs to user names
-- 
-- Instructions:
-- mysql -u root -h 127.0.0.1 -P 3306 swms_db < update_receivedby_issuedby_to_names.sql
-- ============================================

USE swms_db;

-- ============================================
-- UPDATE IN_RECORDS TABLE
-- ============================================

-- Step 1: Add temporary column for names
ALTER TABLE in_records 
ADD COLUMN receivedByName_temp VARCHAR(255) NULL;

-- Step 2: Populate temporary column with user names
UPDATE in_records ir
LEFT JOIN users u ON ir.receivedBy = u.userId
SET ir.receivedByName_temp = COALESCE(u.name, 'Unknown');

-- Step 3: Drop foreign key constraint (if exists)
SET @fk_name = (SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = 'swms_db' AND TABLE_NAME = 'in_records' AND COLUMN_NAME = 'receivedBy' LIMIT 1);
SET @sql = IF(@fk_name IS NOT NULL, CONCAT('ALTER TABLE in_records DROP FOREIGN KEY ', @fk_name), 'SELECT "No foreign key found"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Step 4: Drop old receivedBy column
ALTER TABLE in_records 
DROP COLUMN receivedBy;

-- Step 5: Rename temporary column to receivedBy
ALTER TABLE in_records 
CHANGE COLUMN receivedByName_temp receivedBy VARCHAR(255) NULL;

-- Step 6: Add index for better performance
ALTER TABLE in_records 
ADD INDEX idx_received_by (receivedBy);

-- ============================================
-- UPDATE OUT_RECORDS TABLE
-- ============================================

-- Step 1: Add temporary column for names
ALTER TABLE out_records 
ADD COLUMN issuedByName_temp VARCHAR(255) NULL;

-- Step 2: Populate temporary column with user names
UPDATE out_records or_out
LEFT JOIN users u ON or_out.issuedBy = u.userId
SET or_out.issuedByName_temp = COALESCE(u.name, 'Unknown');

-- Step 3: Drop foreign key constraint (if exists)
SET @fk_name = (SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = 'swms_db' AND TABLE_NAME = 'out_records' AND COLUMN_NAME = 'issuedBy' LIMIT 1);
SET @sql = IF(@fk_name IS NOT NULL, CONCAT('ALTER TABLE out_records DROP FOREIGN KEY ', @fk_name), 'SELECT "No foreign key found"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Step 4: Drop old issuedBy column
ALTER TABLE out_records 
DROP COLUMN issuedBy;

-- Step 5: Rename temporary column to issuedBy
ALTER TABLE out_records 
CHANGE COLUMN issuedByName_temp issuedBy VARCHAR(255) NULL;

-- Step 6: Add index for better performance
ALTER TABLE out_records 
ADD INDEX idx_issued_by (issuedBy);

-- ============================================
-- SUCCESS MESSAGE
-- ============================================
SELECT 
    'Columns updated successfully! ✅' AS message,
    (SELECT COUNT(*) FROM in_records WHERE receivedBy IS NOT NULL) AS in_records_with_names,
    (SELECT COUNT(*) FROM out_records WHERE issuedBy IS NOT NULL) AS out_records_with_names;

