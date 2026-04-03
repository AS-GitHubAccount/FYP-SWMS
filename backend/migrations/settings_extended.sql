-- ============================================
-- Extended System Settings
-- Run: mysql -u root -p swms_db < migrations/settings_extended.sql
-- Or from backend/: mysql -u root -p swms_db < migrations/settings_extended.sql
-- ============================================

USE swms_db;

-- Add new settings with defaults (ON DUPLICATE KEY UPDATE keeps existing)
INSERT INTO system_settings (settingKey, settingValue) VALUES
  ('nearExpiryDays', '7'),
  ('companyName', ''),
  ('timezone', 'UTC'),
  ('dateFormat', 'YYYY-MM-DD'),
  ('sessionTimeoutMinutes', '1440'),
  ('emailNotificationsEnabled', '1'),
  ('defaultMinStock', '10')
ON DUPLICATE KEY UPDATE settingKey = settingKey;
