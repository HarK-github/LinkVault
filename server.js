/**
 * LinkVault - Express HTTP Server & Main Application Entry Point
 *
 * This file configures the web server and defines all REST API endpoints:
 * - GET /health: Health check endpoint for uptime monitoring
 * - GET /qr: Generates QR codes as SVG for mobile camera scanning
 * - POST /upload: Handles file uploads and creates expiring links
 * - GET /f/:id: Shows file metadata or loads the web page
 * - POST /f/:id/verify-password: Validates password without consuming download count
 * - GET & POST /f/:id/download: Streams the requested file to the user
 * - DELETE /f/:id: Deletes a file using its secret delete token
 * - GET /beam/:roomId: Loads the WebRTC direct peer-to-peer transfer interface
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const QRCode = require('qrcode');

// Internal modules
const { initDb, getDb } = require('./src/db');
const { upload, parseExpiry, UPLOADS_DIR } = require('./src/storage');
const {
  getFileById,
  getActiveFile,
  incrementDownloadAtomic,
  deleteFileRecord,
  getFilePath,
  formatFileResponse
} = require('./src/files');
const { hashPassword, verifyPassword } = require('./src/auth');
const { uploadLimiter, downloadLimiter } = require('./src/limiter');
const { startCleanupInterval, stopCleanupInterval } = require('./src/cleanup');
const { initSignaling } = require('./src/signaling');

// Create the Express application
const app = express();
const PORT = process.env.PORT || 3000;

// Tell Express to trust reverse proxy headers (e.g. from Render or Cloudflare)
// This ensures client IP addresses are read accurately for rate limiting.
app.set('trust proxy', 1);

// Middleware to parse JSON and URL-encoded form data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files (HTML, CSS, client-side JS) from the public/ folder
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Parses the optional max_downloads field from the upload request body.
 *
 * @param {string|number} rawValue - User input for max downloads.
 * @returns {number|null} Valid positive integer, or null if unlimited.
 */
function parseMaxDownloads(rawValue) {
  if (!rawValue) {
    return null;
  }
  const parsedNumber = parseInt(rawValue, 10);
  if (!isNaN(parsedNumber) && parsedNumber > 0) {
    return parsedNumber;
  }
  return null;
}

/**
 * Constructs the absolute URL for a download link based on request headers.
 *
 * @param {object} req - Express request object.
 * @param {string} relativePath - The relative path (e.g. /f/abcdef123456).
 * @returns {string} Full URL (e.g. https://linkvault.example.com/f/abcdef123456).
 */
function buildFullUrl(req, relativePath) {
  const host = req.get('host');
  const protocol = req.protocol;
  if (host) {
    return `${protocol}://${host}${relativePath}`;
  }
  return relativePath;
}

// ============================================================================
// ROUTES & ENDPOINTS
// ============================================================================

/**
 * GET /health
 * Lightweight health check endpoint used by hosting providers (Render, Fly.io, etc.)
 * to verify that the server is alive and responding.
 */
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: Date.now() });
});

/**
 * GET /qr
 * Generates an SVG QR code for any given URL or text.
 * Allows mobile users to scan their phone camera directly off a desktop screen.
 */
app.get('/qr', (req, res) => {
  const text = req.query.text;
  if (!text) {
    return res.status(400).send('Missing text parameter');
  }

  // Generate vector SVG QR code (sharp at any resolution)
  QRCode.toString(text, { type: 'svg', margin: 1, width: 220 }, (err, svg) => {
    if (err) {
      return res.status(500).send('Failed to generate QR code');
    }
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
    return res.status(200).send(svg);
  });
});

/**
 * POST /upload
 * Handles file uploads:
 * 1. Multer receives the multipart file and saves it into /uploads.
 * 2. Generates a random 24-character file ID and a secret 32-character delete token.
 * 3. Hashes the password (if supplied).
 * 4. Inserts the file metadata record into the SQLite database.
 * 5. Returns the shareable link and delete token to the uploader.
 */
app.post('/upload', uploadLimiter, (req, res) => {
  upload.single('file')(req, res, (err) => {
    // 1. Handle file upload errors
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File exceeds 50 MB limit' });
      }
      return res.status(400).json({ error: err.message || 'File upload failed' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    try {
      const db = getDb();

      // Generate cryptographically random identifiers
      const id = crypto.randomBytes(12).toString('hex');          // 24 hex characters
      const deleteToken = crypto.randomBytes(16).toString('hex'); // 32 hex characters

      const originalName = path.basename(req.file.originalname);
      const storedName = req.file.filename;
      const size = req.file.size;
      const createdAt = Date.now();
      const expiresAt = parseExpiry(req.body.expiry);
      const passwordHash = hashPassword(req.body.password);
      const maxDownloads = parseMaxDownloads(req.body.max_downloads);

      // Insert metadata into the database
      const insertStatement = db.prepare(`
        INSERT INTO files (
          id, original_name, stored_name, size, password_hash,
          expires_at, max_downloads, downloads, delete_token, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `);

      insertStatement.run(
        id, originalName, storedName, size, passwordHash,
        expiresAt, maxDownloads, deleteToken, createdAt
      );

      const downloadUrl = `/f/${id}`;
      const fullUrl = buildFullUrl(req, downloadUrl);

      // Respond with link and management metadata
      return res.status(201).json({
        id: id,
        download_url: downloadUrl,
        full_url: fullUrl,
        delete_token: deleteToken,
        original_name: originalName,
        size: size,
        has_password: Boolean(passwordHash),
        expires_at: expiresAt,
        max_downloads: maxDownloads,
        created_at: createdAt
      });
    } catch (dbError) {
      console.error('Error saving uploaded file record:', dbError);
      return res.status(500).json({ error: 'Failed to process file upload' });
    }
  });
});

/**
 * GET /f/:id
 * Fetches file metadata:
 * - If requested by a web browser (accept: text/html), serves index.html to show download UI.
 * - If requested via AJAX or API, returns file metadata JSON.
 */
app.get('/f/:id', downloadLimiter, (req, res) => {
  const file = getActiveFile(req.params.id);
  const isHtmlBrowserRequest = Boolean(req.headers.accept && req.headers.accept.includes('text/html') && !req.xhr);
  const indexPath = path.join(__dirname, 'public', 'index.html');

  if (!file) {
    if (isHtmlBrowserRequest && fs.existsSync(indexPath)) {
      return res.status(404).sendFile(indexPath);
    }
    return res.status(404).json({ error: 'File not found or link has expired' });
  }

  if (isHtmlBrowserRequest && fs.existsSync(indexPath)) {
    return res.status(200).sendFile(indexPath);
  }

  return res.status(200).json(formatFileResponse(file));
});

/**
 * GET /beam/:roomId
 * Serves the single-page application for direct WebRTC peer-to-peer file transfers.
 */
app.get('/beam/:roomId', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  return res.status(404).send('Page not found');
});

/**
 * POST /f/:id/verify-password
 * Checks if the user-entered password is correct BEFORE initiating a download.
 * Does not decrement the download limit.
 */
app.post('/f/:id/verify-password', (req, res) => {
  const file = getActiveFile(req.params.id);
  if (!file) {
    return res.status(404).json({ error: 'File not found or link has expired' });
  }

  // If the file is not password-protected, verification automatically succeeds
  if (!file.password_hash) {
    return res.status(200).json({ ok: true });
  }

  // Get password from JSON body or URL query
  const providedPassword = (req.body && req.body.password) || (req.query && req.query.password);
  if (!verifyPassword(providedPassword, file.password_hash)) {
    return res.status(403).json({ error: 'Incorrect password' });
  }

  return res.status(200).json({ ok: true });
});

/**
 * Core Download Handler function:
 * Used by both GET /f/:id/download and POST /f/:id/download.
 * 1. Checks that the file is active (not expired).
 * 2. Checks password (if required).
 * 3. Atomically increments download count in SQLite (prevents race conditions).
 * 4. Streams the binary file to the user's browser.
 */
function handleDownload(req, res) {
  const file = getActiveFile(req.params.id);
  if (!file) {
    return res.status(404).json({ error: 'File not found or link has expired' });
  }

  // 1. Password verification
  if (file.password_hash) {
    const providedPassword = (req.body && req.body.password) || (req.query && req.query.password);
    if (!verifyPassword(providedPassword, file.password_hash)) {
      return res.status(403).json({ error: 'Incorrect or missing password' });
    }
  }

  // 2. Atomic download count increment
  const wasIncremented = incrementDownloadAtomic(file.id);
  if (!wasIncremented) {
    return res.status(404).json({ error: 'File not found or link has expired' });
  }

  // 3. Check physical file existence on disk
  const physicalPath = getFilePath(file.stored_name);
  if (!fs.existsSync(physicalPath)) {
    return res.status(404).json({ error: 'File not found on disk' });
  }

  // 4. Send file download stream with Content-Disposition attachment header
  const encodedFilename = encodeURIComponent(file.original_name);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`
  );
  return res.download(physicalPath, file.original_name);
}

// Support both POST and GET for seamless downloads on desktop and mobile browsers
app.post('/f/:id/download', downloadLimiter, handleDownload);
app.get('/f/:id/download', downloadLimiter, handleDownload);

/**
 * DELETE /f/:id
 * Allows the original uploader to delete their file immediately using their secret delete token.
 */
app.delete('/f/:id', (req, res) => {
  const file = getFileById(req.params.id);
  if (!file) {
    return res.status(404).json({ error: 'File not found or link has expired' });
  }

  // Extract delete token from HTTP header or query string
  const token = req.headers['x-delete-token'] || (req.query && req.query.token);
  if (!token || token !== file.delete_token) {
    return res.status(403).json({ error: 'Invalid or missing delete token' });
  }

  // Delete from disk and database
  deleteFileRecord(file.id);
  return res.status(200).json({ success: true, message: 'File deleted successfully' });
});

// Initialize database when the file is loaded
initDb();

let server = null;
let cleanupInterval = null;

// Only start listening and cleanup if run directly from the command line (not when imported in unit tests)
if (require.main === module) {
  cleanupInterval = startCleanupInterval();

  server = app.listen(PORT, () => {
    console.log(`LinkVault server listening on port ${PORT}`);
  });

  // Attach WebSocket signaling to the HTTP server
  initSignaling(server);

  // Graceful shutdown logic: clean up intervals and open connections cleanly
  const gracefulShutdown = () => {
    console.log('Shutting down server gracefully...');
    stopCleanupInterval();
    if (server) {
      server.close(() => {
        console.log('HTTP server closed.');
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  };

  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);
}

module.exports = app;
