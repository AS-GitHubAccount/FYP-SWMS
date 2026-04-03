/**
 * Combined Purchasing API - RFQ creation and file uploads
 * Provides /api/purchasing/rfq and /api/purchasing/upload/* for compatibility
 */

const express = require('express');
const router = express.Router();
const rfqsRouter = require('./rfqs');
const purchasingUploadsRouter = require('./purchasingUploads');

// POST /api/purchasing/rfq - Create RFQ (alias for POST /api/rfqs)
router.post('/rfq', (req, res, next) => {
    const origUrl = req.url;
    req.url = '/';
    rfqsRouter(req, res, (err) => {
        req.url = origUrl;
        if (err) next(err);
    });
});

// Mount upload routes - /api/purchasing/upload/quotations/:id/attachment, /api/purchasing/upload/purchase-orders/:id/attachment
router.use('/upload', purchasingUploadsRouter);

module.exports = router;
