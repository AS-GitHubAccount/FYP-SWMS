-- ============================================
-- Booking–Issuing traceability (Issuing Record Number)
-- Run once: mysql -u root -p swms_db < migrations/booking_issuing_link.sql
-- ============================================

USE swms_db;

-- Add issuing_id to bookings (FK to out_records.recordId when fulfilled)
ALTER TABLE bookings ADD COLUMN issuing_id INT NULL;
ALTER TABLE bookings ADD INDEX idx_bookings_issuing_id (issuing_id);
-- Optional FK (uncomment if referential integrity is desired):
-- ALTER TABLE bookings ADD CONSTRAINT fk_bookings_issuing FOREIGN KEY (issuing_id) REFERENCES out_records(recordId);

-- Allow VIEW action in audit_log for "view booking/transaction" tracking
ALTER TABLE audit_log MODIFY COLUMN action ENUM('INSERT', 'UPDATE', 'DELETE', 'VIEW') NOT NULL;

SELECT 'Booking–issuing link migration applied.' AS message;
