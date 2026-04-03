/**
 * Price history benchmarks for RFQ / compare UI and notifications.
 */

const db = require('../config/database');

/**
 * @param {number} productId
 * @returns {Promise<{ lastPrice: number|null, lastAt: string|null, lastSupplierName: string|null, avg12: number|null, count12: number, series: Array<{date:string, unitPrice:number, supplierName:string|null}> }>}
 */
async function getProductPriceBenchmark(productId) {
    const pid = parseInt(productId, 10);
    if (!pid || Number.isNaN(pid)) {
        return {
            lastPrice: null,
            lastAt: null,
            lastSupplierName: null,
            avg12: null,
            count12: 0,
            series: []
        };
    }

    const [lastRows] = await db.execute(
        `
        SELECT ph.unitPrice, ph.recordedAt, s.name AS supplierName
        FROM price_history ph
        LEFT JOIN suppliers s ON ph.supplierId = s.supplierId
        WHERE ph.productId = ?
        ORDER BY ph.recordedAt DESC, ph.historyId DESC
        LIMIT 1
        `,
        [pid]
    );

    const [avgRows] = await db.execute(
        `
        SELECT AVG(unitPrice) AS avgPrice, COUNT(*) AS cnt
        FROM price_history
        WHERE productId = ?
          AND recordedAt >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
        `,
        [pid]
    );

    const [seriesRows] = await db.execute(
        `
        SELECT ph.recordedAt, ph.unitPrice, s.name AS supplierName
        FROM price_history ph
        LEFT JOIN suppliers s ON ph.supplierId = s.supplierId
        WHERE ph.productId = ?
          AND ph.recordedAt >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
        ORDER BY ph.recordedAt ASC, ph.historyId ASC
        `,
        [pid]
    );

    const last = lastRows[0];
    let avg12 = null;
    if (avgRows[0] && avgRows[0].avgPrice != null) {
        avg12 = parseFloat(avgRows[0].avgPrice);
        if (Number.isNaN(avg12)) avg12 = null;
    }

    return {
        lastPrice: last ? parseFloat(last.unitPrice) : null,
        lastAt: last ? String(last.recordedAt) : null,
        lastSupplierName: last ? last.supplierName : null,
        avg12,
        count12: avgRows[0] ? parseInt(avgRows[0].cnt, 10) || 0 : 0,
        series: (seriesRows || []).map((r) => ({
            date: String(r.recordedAt),
            unitPrice: parseFloat(r.unitPrice),
            supplierName: r.supplierName || null
        }))
    };
}

/**
 * One row per PO when marked complete (RECEIVED). Idempotent by poId.
 * @param {object} po — row from purchase_orders
 */
async function recordPriceHistoryFromPurchaseOrder(po) {
    if (!po || !po.poId || !po.productId) return;
    const [dup] = await db.execute('SELECT historyId FROM price_history WHERE poId = ? LIMIT 1', [po.poId]);
    if (dup.length) return;

    const unit = parseFloat(po.unitPrice);
    if (Number.isNaN(unit)) return;

    await db.execute(
        `
        INSERT INTO price_history (productId, supplierId, unitPrice, currency, quantity, poId, recordedAt)
        VALUES (?, ?, ?, 'USD', ?, ?, COALESCE(?, CURDATE()))
        `,
        [
            po.productId,
            po.supplierId != null ? po.supplierId : null,
            unit,
            po.quantity != null ? po.quantity : null,
            po.poId,
            po.orderDate || null
        ]
    );
}

module.exports = { getProductPriceBenchmark, recordPriceHistoryFromPurchaseOrder };
