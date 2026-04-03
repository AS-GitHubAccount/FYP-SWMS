/**
 * Reference ID Generator
 * Format: TYPE-yymm-xxxx
 * - TYPE: BK, IN, OUT, PR, DR, RFQ, PO
 * - yy: 2-digit year (e.g. 25 for 2025)
 * - mm: 2-digit month (e.g. 11 for November)
 * - xxxx: 4-digit sequence 0001-9999 for that type in that month
 */

const db = require('../config/database');

const CONFIG = {
    booking: { prefix: 'BK', table: 'bookings', column: 'bookingNumber' },
    inRecord: { prefix: 'IN', table: 'in_records', column: 'recordNumber' },
    outRecord: { prefix: 'OUT', table: 'out_records', column: 'recordNumber' },
    purchaseRequest: { prefix: 'PR', table: 'purchase_requests', column: 'requestNumber' },
    disposalRequest: { prefix: 'DR', table: 'disposal_requests', column: 'requestNumber' },
    rfq: { prefix: 'RFQ', table: 'rfqs', column: 'rfqNumber' },
    purchaseOrder: { prefix: 'PO', table: 'purchase_orders', column: 'poNumber' }
};

/**
 * Generate next reference number for the given type.
 * @param {keyof CONFIG} type - One of: booking, inRecord, outRecord, purchaseRequest, disposalRequest, rfq, purchaseOrder
 * @returns {Promise<string>} e.g. 'BK-2511-0002', 'PR-2503-0015'
 */
async function generateReferenceNumber(type) {
    const config = CONFIG[type];
    if (!config) {
        throw new Error(`Unknown ID type: ${type}`);
    }

    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yymm = yy + mm;
    const likePattern = `${config.prefix}-${yymm}-%`;

    const [rows] = await db.execute(
        `SELECT COUNT(*) AS cnt FROM \`${config.table}\` WHERE \`${config.column}\` LIKE ?`,
        [likePattern]
    );

    const nextSeq = (rows[0]?.cnt || 0) + 1;
    return `${config.prefix}-${yymm}-${String(nextSeq).padStart(4, '0')}`;
}

// Convenience wrappers
async function generateBookingNumber() {
    return generateReferenceNumber('booking');
}
async function generateRecordNumber(type = 'OUT') {
    return type.toUpperCase() === 'IN'
        ? generateReferenceNumber('inRecord')
        : generateReferenceNumber('outRecord');
}
async function generateRequestNumber(context = 'purchase') {
    return context === 'disposal'
        ? generateReferenceNumber('disposalRequest')
        : generateReferenceNumber('purchaseRequest');
}
async function generateRfqNumber() {
    return generateReferenceNumber('rfq');
}
async function generatePoNumber() {
    return generateReferenceNumber('purchaseOrder');
}

module.exports = {
    generateReferenceNumber,
    generateBookingNumber,
    generateRecordNumber,
    generateRequestNumber,
    generateRfqNumber,
    generatePoNumber,
    CONFIG
};
