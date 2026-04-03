-- ============================================
-- Add location and notes columns to batches table
-- ============================================
-- Run this in MySQL to add the missing columns

USE swms_db;

-- Add location column
ALTER TABLE batches 
ADD COLUMN location VARCHAR(255) NULL AFTER supplier;

-- Add notes column
ALTER TABLE batches 
ADD COLUMN notes TEXT NULL AFTER location;

-- Verify the changes
DESCRIBE batches;








