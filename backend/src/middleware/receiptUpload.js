'use strict';

/**
 * Multer config for the checkout page's optional receipt upload
 * (POST /api/orders/:id/receipt). Files land on local disk under
 * backend/uploads/receipts/, named with a random id — never the client's
 * original filename, which is untrusted input.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads', 'receipts');
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

const ALLOWED_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_ROOT),
  filename: (req, file, cb) => {
    const ext = ALLOWED_MIME[file.mimetype] || '';
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const receiptUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME[file.mimetype]) {
      const err = new Error('Only JPG, PNG, WEBP or PDF receipts are accepted');
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  },
});

// multer.MulterError (e.g. LIMIT_FILE_SIZE) carries no `.status`, which would
// otherwise fall through the global error handler as an opaque 500 — surface
// it as the 400 it actually is instead.
function uploadReceiptMiddleware(req, res, next) {
  receiptUpload.single('receipt')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'Receipt must be 5MB or smaller' : err.message;
      return res.status(400).json({ success: false, message });
    }
    next(err);
  });
}

module.exports = { uploadReceiptMiddleware, UPLOAD_ROOT };
