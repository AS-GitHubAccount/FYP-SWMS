-- Optional: add RFQ test supplier mailboxes to an existing database (safe to re-run).
-- Usage: mysql -u ... -p swms_db < backend/add_rfq_test_supplier_emails.sql

USE swms_db;

INSERT IGNORE INTO suppliers (name, contactPerson, email, phone, address, status) VALUES
('SWMS Test Supplier A', 'QA Mailbox A', 'rfq-test-alpha@example.com', '+1 555-0191', 'RFQ / email test sandbox', 'active'),
('SWMS Test Supplier B', 'QA Mailbox B', 'rfq-test-beta@example.com', '+1 555-0192', 'RFQ / email test sandbox', 'active'),
('SWMS Test Supplier C', 'QA Mailbox C', 'rfq-test-gamma@example.com', '+1 555-0193', 'RFQ / email test sandbox', 'active'),
('SWMS Test Supplier D', 'QA Mailbox D', 'rfq-test-delta@example.com', '+1 555-0194', 'RFQ / email test sandbox', 'active'),
('SWMS Test Supplier E', 'QA Mailbox E', 'rfq-test-epsilon@example.com', '+1 555-0195', 'RFQ / email test sandbox', 'active');

INSERT IGNORE INTO supplier_products (supplierId, productId)
SELECT s.supplierId, p.productId
FROM suppliers s
CROSS JOIN products p
WHERE p.sku IN ('PRD-001', 'PRD-002', 'PRD-003', 'PRD-004', 'PRD-005')
AND s.email IN (
    'rfq-test-alpha@example.com',
    'rfq-test-beta@example.com',
    'rfq-test-gamma@example.com',
    'rfq-test-delta@example.com',
    'rfq-test-epsilon@example.com'
);

SELECT 'RFQ test suppliers added (if not already present).' AS message;
