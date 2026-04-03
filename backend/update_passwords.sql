-- Update passwords for existing users
-- Password "password" hashed with bcrypt

USE swms_db;

-- Update admin@swms.com password to "password"
-- This is the bcrypt hash for "password"
UPDATE users 
SET passwordHash = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy'
WHERE email = 'admin@swms.com';

-- Update staff@swms.com password to "password"
UPDATE users 
SET passwordHash = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy'
WHERE email = 'staff@swms.com';

SELECT 'Passwords updated successfully!' AS message;











