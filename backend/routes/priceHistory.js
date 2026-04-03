/**
 * Price history API — benchmarks and 12-month series for charts.
 */

const express = require('express');
const router = express.Router();
const { getProductPriceBenchmark } = require('../utils/priceHistoryQueries');

router.get('/product/:productId', async (req, res) => {
    try {
        const productId = parseInt(req.params.productId, 10);
        if (!productId) {
            return res.status(400).json({ success: false, error: 'Invalid productId' });
        }
        const data = await getProductPriceBenchmark(productId);
        res.json({ success: true, data });
    } catch (err) {
        console.error('GET /price-history/product/:productId', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
