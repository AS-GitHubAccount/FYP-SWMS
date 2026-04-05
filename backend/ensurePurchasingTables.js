/**
 * Ensures purchasing tables exist so purchasing actions are stored in the database.
 * Run at server startup (non-blocking). Creates tables if missing.
 */

const db = require('./config/database');

async function ensurePurchasingTables() {
    try {
        await db.execute(`
            CREATE TABLE IF NOT EXISTS purchase_request_suppliers (
                id INT PRIMARY KEY AUTO_INCREMENT,
                requestId INT NOT NULL,
                supplierId INT NOT NULL,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY unique_pr_supplier (requestId, supplierId),
                INDEX idx_request (requestId)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        await db.execute(`
            CREATE TABLE IF NOT EXISTS purchase_requests (
                requestId INT PRIMARY KEY AUTO_INCREMENT,
                requestNumber VARCHAR(50) UNIQUE NOT NULL,
                productId INT NOT NULL,
                quantity INT NOT NULL,
                supplierId INT NULL,
                priority ENUM('low','medium','high','urgent') DEFAULT 'medium',
                neededBy DATE,
                sendingLocation VARCHAR(255) NULL,
                requestedBy INT NOT NULL,
                requestedDate DATE DEFAULT (CURRENT_DATE),
                status ENUM('PENDING','APPROVED','REJECTED') DEFAULT 'PENDING',
                approvedBy INT NULL,
                approvedDate DATE NULL,
                rejectedBy INT NULL,
                rejectedDate DATE NULL,
                rejectReason TEXT NULL,
                notes TEXT,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_status (status),
                INDEX idx_requested_by (requestedBy)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        await db.execute(`
            CREATE TABLE IF NOT EXISTS rfqs (
                rfqId INT PRIMARY KEY AUTO_INCREMENT,
                rfqNumber VARCHAR(50) UNIQUE NOT NULL,
                purchaseRequestId INT NOT NULL,
                status ENUM('DRAFT','SENT','QUOTES_RECEIVED','AWARDED','CLOSED') DEFAULT 'DRAFT',
                quoteDueDate DATETIME,
                notes TEXT,
                createdBy INT,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_status (status),
                INDEX idx_pr (purchaseRequestId)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        await db.execute(`
            CREATE TABLE IF NOT EXISTS rfq_suppliers (
                id INT PRIMARY KEY AUTO_INCREMENT,
                rfqId INT NOT NULL,
                supplierId INT NOT NULL,
                status ENUM('SENT','QUOTED','DECLINED') DEFAULT 'SENT',
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY unique_rfq_supplier (rfqId, supplierId),
                INDEX idx_rfq (rfqId)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        await db.execute(`
            CREATE TABLE IF NOT EXISTS quotations (
                quotationId INT PRIMARY KEY AUTO_INCREMENT,
                rfqId INT NOT NULL,
                supplierId INT NOT NULL,
                unitPrice DECIMAL(10,2) NOT NULL,
                totalAmount DECIMAL(12,2) NOT NULL,
                deliveryDate DATE,
                validUntil DATE,
                currency VARCHAR(3) DEFAULT 'USD',
                notes TEXT,
                status ENUM('SUBMITTED','ACCEPTED','REJECTED') DEFAULT 'SUBMITTED',
                submittedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                createdBy INT,
                UNIQUE KEY unique_rfq_supplier_quote (rfqId, supplierId),
                INDEX idx_rfq (rfqId)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        await db.execute(`
            CREATE TABLE IF NOT EXISTS purchase_orders (
                poId INT PRIMARY KEY AUTO_INCREMENT,
                poNumber VARCHAR(50) UNIQUE NOT NULL,
                quotationId INT,
                rfqId INT,
                purchaseRequestId INT,
                supplierId INT NOT NULL,
                productId INT NOT NULL,
                quantity INT NOT NULL,
                unitPrice DECIMAL(10,2) NOT NULL,
                totalAmount DECIMAL(12,2) NOT NULL,
                status ENUM('DRAFT','SENT','CONFIRMED','PARTIAL_RECEIVED','RECEIVED','CANCELLED') DEFAULT 'DRAFT',
                orderDate DATE DEFAULT (CURRENT_DATE),
                expectedDelivery DATE,
                createdBy INT,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_status (status),
                INDEX idx_supplier (supplierId)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        // Price intelligence: logged when a PO is marked RECEIVED (completed)
        await db.execute(`
            CREATE TABLE IF NOT EXISTS price_history (
                historyId INT PRIMARY KEY AUTO_INCREMENT,
                productId INT NOT NULL,
                supplierId INT NULL,
                unitPrice DECIMAL(12,4) NOT NULL,
                currency VARCHAR(3) DEFAULT 'USD',
                quantity INT NULL,
                poId INT NULL,
                recordedAt DATE NOT NULL,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uq_price_history_po (poId),
                INDEX idx_product_recorded (productId, recordedAt),
                INDEX idx_supplier (supplierId)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        // Add attachment columns if they don't exist
        try {
            const [qCol] = await db.execute(
                `SELECT COUNT(*) AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'quotations' AND column_name = 'attachmentPath'`
            );
            if (qCol[0].c === 0) await db.execute('ALTER TABLE quotations ADD COLUMN attachmentPath VARCHAR(500) NULL');
        } catch (_) {}
        try {
            const [pCol] = await db.execute(
                `SELECT COUNT(*) AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'purchase_orders' AND column_name = 'attachmentPath'`
            );
            if (pCol[0].c === 0) await db.execute('ALTER TABLE purchase_orders ADD COLUMN attachmentPath VARCHAR(500) NULL');
        } catch (_) {}
        try {
            const [anCol] = await db.execute(
                `SELECT COUNT(*) AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'purchase_requests' AND column_name = 'approvalNote'`
            );
            if (anCol[0].c === 0) await db.execute('ALTER TABLE purchase_requests ADD COLUMN approvalNote TEXT NULL');
        } catch (_) {}

        // Ensure approvalReason exists on disposal_requests (for approval history)
        try {
            const [drCol] = await db.execute(
                `SELECT COUNT(*) AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'disposal_requests' AND column_name = 'approvalReason'`
            );
            if (drCol[0].c === 0) await db.execute('ALTER TABLE disposal_requests ADD COLUMN approvalReason TEXT NULL');
        } catch (_) {}

        // Ensure sendingLocation column exists on purchase_requests
        try {
            const [slCol] = await db.execute(
                `SELECT COUNT(*) AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'purchase_requests' AND column_name = 'sendingLocation'`
            );
            if (slCol[0].c === 0) {
                await db.execute('ALTER TABLE purchase_requests ADD COLUMN sendingLocation VARCHAR(255) NULL AFTER neededBy');
            }
        } catch (_) {}

        // RFQ: store last sent snapshot + withdrawal workflow columns
        const rfqCols = [
            { name: 'last_sent_at', def: 'ALTER TABLE rfqs ADD COLUMN last_sent_at DATETIME NULL' },
            { name: 'last_sent_to', def: 'ALTER TABLE rfqs ADD COLUMN last_sent_to TEXT NULL' },
            { name: 'last_sent_cc', def: 'ALTER TABLE rfqs ADD COLUMN last_sent_cc TEXT NULL' },
            { name: 'last_sent_bcc', def: 'ALTER TABLE rfqs ADD COLUMN last_sent_bcc TEXT NULL' },
            { name: 'last_sent_subject', def: 'ALTER TABLE rfqs ADD COLUMN last_sent_subject VARCHAR(500) NULL' },
            { name: 'last_sent_body', def: 'ALTER TABLE rfqs ADD COLUMN last_sent_body LONGTEXT NULL' },
            { name: 'withdrawal_reason', def: 'ALTER TABLE rfqs ADD COLUMN withdrawal_reason TEXT NULL' },
            { name: 'withdrawal_requested_at', def: 'ALTER TABLE rfqs ADD COLUMN withdrawal_requested_at DATETIME NULL' },
            { name: 'withdrawal_requested_by', def: 'ALTER TABLE rfqs ADD COLUMN withdrawal_requested_by INT NULL' },
            { name: 'withdrawal_approved_by', def: 'ALTER TABLE rfqs ADD COLUMN withdrawal_approved_by INT NULL' },
            { name: 'withdrawal_approved_at', def: 'ALTER TABLE rfqs ADD COLUMN withdrawal_approved_at DATETIME NULL' }
        ];
        for (const col of rfqCols) {
            try {
                const [c] = await db.execute(
                    `SELECT COUNT(*) AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'rfqs' AND column_name = ?`,
                    [col.name]
                );
                if (c[0].c === 0) await db.execute(col.def);
            } catch (_) {}
        }
        try {
            await db.execute(`
                ALTER TABLE rfqs MODIFY COLUMN status
                ENUM('DRAFT','SENT','QUOTES_RECEIVED','AWARDED','CLOSED','WITHDRAW_PENDING','WITHDRAWN') DEFAULT 'DRAFT'
            `);
        } catch (_) {}

        // quoteDueDate: DATE → DATETIME so quotation can have a deadline time (not just calendar day)
        try {
            const [dtCol] = await db.execute(
                `SELECT DATA_TYPE FROM information_schema.columns
                 WHERE table_schema = DATABASE() AND table_name = 'rfqs' AND column_name = 'quoteDueDate'`
            );
            if (dtCol.length && String(dtCol[0].DATA_TYPE || '').toLowerCase() === 'date') {
                await db.execute('ALTER TABLE rfqs MODIFY COLUMN quoteDueDate DATETIME NULL');
                console.log('[ensurePurchasingTables] rfqs.quoteDueDate upgraded to DATETIME');
            }
        } catch (e) {
            console.warn('[ensurePurchasingTables] quoteDueDate DATETIME:', e.message);
        }

        // Add FKs only if they don't exist (avoid errors on re-run)
        const tables = ['purchase_request_suppliers', 'purchase_requests', 'rfqs', 'rfq_suppliers', 'quotations', 'purchase_orders'];
        for (const t of tables) {
            try {
                const [rows] = await db.execute(
                    `SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?`,
                    [t]
                );
                if (rows[0].c > 0) {
                    // Table exists; FKs may already be there from full migrations
                }
            } catch (_) {}
        }

        return true;
    } catch (err) {
        console.error('[ensurePurchasingTables]', err.message);
        return false;
    }
}

module.exports = { ensurePurchasingTables };
