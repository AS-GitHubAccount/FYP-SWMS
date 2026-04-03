/**
 * Purchasing file uploads - quotations and purchase orders
 * Stores files in uploads/purchasing/
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../config/database');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'purchasing');

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
ensureDir(UPLOAD_DIR);
ensureDir(path.join(UPLOAD_DIR, 'quotations'));
ensureDir(path.join(UPLOAD_DIR, 'purchase_orders'));

const uploadQuotation = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            const dest = path.join(UPLOAD_DIR, 'quotations');
            ensureDir(dest);
            cb(null, dest);
        },
        filename: (req, file, cb) => {
            const id = req.params.quotationId;
            const ext = path.extname(file.originalname) || '.pdf';
            const safe = (file.originalname || 'file').replace(/[^a-zA-Z0-9.-]/g, '_').slice(0, 50);
            cb(null, `${id}-${Date.now()}-${safe}${ext}`);
        }
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (/\.(pdf|jpg|jpeg|png|gif|webp)$/i.test(file.originalname)) cb(null, true);
        else cb(new Error('Only PDF and images allowed'));
    }
});

const uploadPo = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            const dest = path.join(UPLOAD_DIR, 'purchase_orders');
            ensureDir(dest);
            cb(null, dest);
        },
        filename: (req, file, cb) => {
            const id = req.params.id;
            const ext = path.extname(file.originalname) || '.pdf';
            const safe = (file.originalname || 'file').replace(/[^a-zA-Z0-9.-]/g, '_').slice(0, 50);
            cb(null, `${id}-${Date.now()}-${safe}${ext}`);
        }
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (/\.(pdf|jpg|jpeg|png|gif|webp)$/i.test(file.originalname)) cb(null, true);
        else cb(new Error('Only PDF and images allowed'));
    }
});


// POST /api/purchasing-uploads/quotations/:quotationId/attachment
router.post('/quotations/:quotationId/attachment', uploadQuotation.single('file'), async (req, res) => {
    try {
        const { quotationId } = req.params;
        if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });
        const relativePath = `purchasing/quotations/${req.file.filename}`;
        await db.execute('UPDATE quotations SET attachmentPath = ? WHERE quotationId = ?', [relativePath, quotationId]);
        res.json({ success: true, message: 'Attachment uploaded', data: { path: relativePath, filename: req.file.filename } });
    } catch (err) {
        console.error('Upload quotation attachment:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/purchasing-uploads/purchase-orders/:id/attachment
router.post('/purchase-orders/:id/attachment', uploadPo.single('file'), async (req, res) => {
    try {
        const id = req.params.id;
        if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });
        const relativePath = `purchasing/purchase_orders/${req.file.filename}`;
        await db.execute('UPDATE purchase_orders SET attachmentPath = ? WHERE poId = ?', [relativePath, id]);
        res.json({ success: true, message: 'Attachment uploaded', data: { path: relativePath, filename: req.file.filename } });
    } catch (err) {
        console.error('Upload PO attachment:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
