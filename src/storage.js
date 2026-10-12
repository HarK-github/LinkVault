/**
 * LinkVault - File Storage and Multer Upload Configuration
 *
 * This module configures how incoming files are saved to the server's hard drive:
 * 1. Checks that the uploads folder exists.
 * 2. Generates random, unguessable filenames using crypto.randomUUID() to prevent collisions.
 * 3. Enforces a maximum file size limit (50 MB).
 * 4. Parses human-readable expiration inputs (e.g. "30m", "2h", "7d", or raw numbers).
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

// Directory where uploaded files will be stored on the server
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');

// Ensure the upload directory exists when the server starts
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Maximum allowed upload size: 50 Megabytes (in bytes)
const MAX_FILE_SIZE = 50 * 1024 * 1024;

/**
 * Configure Multer to save uploaded files directly to disk.
 * Each file is given a random UUID filename plus its original extension,
 * preventing users from overwriting existing files with the same name.
 */
const storage = multer.diskStorage({
  destination: function (req, file, callback) {
    callback(null, UPLOADS_DIR);
  },
  filename: function (req, file, callback) {
    const fileExtension = path.extname(file.originalname).slice(0, 10);
    const uniqueFileName = crypto.randomUUID() + fileExtension;
    callback(null, uniqueFileName);
  }
});

// Multer upload middleware instance
const upload = multer({
  storage: storage,
  limits: {
    fileSize: MAX_FILE_SIZE
  }
});

function parseHumanExpiryString(text, currentTime) {
  const match = text.trim().toLowerCase().match(/^(\d+)\s*(m|min|minute|minutes|h|hr|hour|hours|d|day|days|w|week|weeks)$/);
  if (!match) return null;
  const mult = { m: 60e3, h: 36e5, d: 864e5, w: 6048e5 }[match[2][0]];
  return mult ? currentTime + parseInt(match[1], 10) * mult : null;
}

/**
 * Calculates the expiration timestamp based on user input.
 *
 * Supports:
 * - Empty/undefined: Defaults to 24 hours from now.
 * - Millisecond timestamp: e.g. 1770000000000 (after year 2020).
 * - Number of hours: e.g. 1, 24, 72.
 * - Human strings: e.g. "30m", "4h", "2d", "1w".
 *
 * @param {string|number} [expiryInput] - The raw expiry parameter from the user.
 * @returns {number} Expiration timestamp in milliseconds (Date.now() + duration).
 */
function parseExpiry(expiryInput) {
  const now = Date.now();
  const DEFAULT_24_HOURS_MS = 24 * 60 * 60 * 1000;

  // 1. If nothing was provided, default to 24 hours
  if (!expiryInput) {
    return now + DEFAULT_24_HOURS_MS;
  }

  // 2. If given as a number or a numeric string
  if (typeof expiryInput === 'number' || !isNaN(Number(expiryInput))) {
    const num = Number(expiryInput);

    // If it's already a future timestamp (greater than Jan 1, 2020)
    const TIMESTAMP_THRESHOLD_2020 = 1577836800000;
    if (num > TIMESTAMP_THRESHOLD_2020) {
      return num;
    }

    // Otherwise treat it as a number of hours
    const ONE_HOUR_MS = 60 * 60 * 1000;
    return now + num * ONE_HOUR_MS;
  }

  // 3. If given as a text string (e.g. "2h", "10m", "3d")
  if (typeof expiryInput === 'string') {
    const parsedFromText = parseHumanExpiryString(expiryInput, now);
    if (parsedFromText !== null) {
      return parsedFromText;
    }
  }

  // 4. Fallback default: 24 hours
  return now + DEFAULT_24_HOURS_MS;
}

module.exports = {
  UPLOADS_DIR,
  MAX_FILE_SIZE,
  upload,
  parseExpiry
};
