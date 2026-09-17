const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    // Generate a random, cryptographically secure unique filename on disk
    const randomName = crypto.randomUUID() + path.extname(file.originalname).slice(0, 10);
    cb(null, randomName);
  }
});

// Max 50 MB upload limit
const MAX_FILE_SIZE = 50 * 1024 * 1024;

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE
  }
});

function parseExpiry(expiryInput) {
  const now = Date.now();
  if (!expiryInput) {
    // Default 24 hours
    return now + 24 * 60 * 60 * 1000;
  }

  if (typeof expiryInput === 'number' || !isNaN(Number(expiryInput))) {
    const num = Number(expiryInput);
    // If sent as timestamp in milliseconds (greater than year 2020)
    if (num > 1577836800000) {
      return num;
    }
    // If sent as hours
    return now + num * 60 * 60 * 1000;
  }

  if (typeof expiryInput === 'string') {
    const match = expiryInput.trim().toLowerCase().match(/^(\d+)\s*(m|min|minute|minutes|h|hr|hour|hours|d|day|days|w|week|weeks)$/);
    if (match) {
      const val = parseInt(match[1], 10);
      const unit = match[2];
      if (unit.startsWith('m')) return now + val * 60 * 1000;
      if (unit.startsWith('h')) return now + val * 60 * 60 * 1000;
      if (unit.startsWith('d')) return now + val * 24 * 60 * 60 * 1000;
      if (unit.startsWith('w')) return now + val * 7 * 24 * 60 * 60 * 1000;
    }
  }

  // Fallback default 24h
  return now + 24 * 60 * 60 * 1000;
}

module.exports = {
  UPLOADS_DIR,
  MAX_FILE_SIZE,
  upload,
  parseExpiry
};
