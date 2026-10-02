'use strict';
const path = require('path');
const multer = require('multer');
const db = require('./db');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, db.UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic'].includes(ext) ? ext : '.jpg';
    cb(null, `up-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${safeExt}`);
  }
});

function imageOnly(req, file, cb) {
  if (!file.mimetype.startsWith('image/')) {
    return cb(new Error('仅支持上传图片文件（jpg/png/webp 等）'));
  }
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter: imageOnly,
  limits: { fileSize: 8 * 1024 * 1024, files: 6 }
});

module.exports = { upload };
