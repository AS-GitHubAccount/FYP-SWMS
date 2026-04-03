-- Add rejectReason to bookings table (for existing databases)
-- Run: mysql -u root -p swms_db < add_reject_reason.sql
-- Or in MySQL: SOURCE add_reject_reason.sql;
-- Ignore error if column already exists.

USE swms_db;

ALTER TABLE bookings ADD COLUMN rejectReason TEXT NULL;
