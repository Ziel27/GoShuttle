const multer = require('multer');

const MAX_RECEIPT_BYTES = 6 * 1024 * 1024; // 6MB

// Use memory storage and write to disk ourselves (lets us validate mimetype + generate filenames).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_RECEIPT_BYTES },
  fileFilter: (_req, file, cb) => {
    const mime = String(file.mimetype || '').toLowerCase();
    const ok = mime.startsWith('image/');
    if (!ok) {
      cb(new Error('Receipt must be an image file.'));
      return;
    }
    cb(null, true);
  },
});

module.exports = { upload, MAX_RECEIPT_BYTES };
