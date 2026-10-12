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

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

function parseMaxDownloads(rawValue) {
  const n = parseInt(rawValue, 10);
  return n > 0 ? n : null;
}

function buildFullUrl(req, relativePath) {
  return req.get('host') ? `${req.protocol}://${req.get('host')}${relativePath}` : relativePath;
}

// ============================================================================
// ROUTES & ENDPOINTS
// ============================================================================

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: Date.now() });
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
  const isHtml = Boolean(req.headers.accept && req.headers.accept.includes('text/html') && !req.xhr);
  const indexPath = path.join(__dirname, 'public', 'index.html');

  if (isHtml) {
    return res.status(file ? 200 : 404).sendFile(indexPath);
  }
  return file ? res.status(200).json(formatFileResponse(file)) : res.status(404).json({ error: 'File not found or link has expired' });
});

app.get('/beam/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
app.all('/f/:id/download', downloadLimiter, handleDownload);

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
