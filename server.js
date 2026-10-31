/**
 * LinkVault - Express HTTP Server & Main Application Entry Point
 *
 * This file configures the web server and defines all REST API endpoints:
 * - GET /health: Health check endpoint with database, storage & room metrics
 * - POST /upload/presign: Direct-to-Cloudflare-R2 presigned PUT URL generation
 * - POST /upload: Standard multipart upload (saved to local disk or R2)
 * - GET /f/:id: Shows file metadata or loads the download web interface
 * - POST /f/:id/verify-password: Validates password without consuming download count
 * - GET & POST /f/:id/download: Token-gated atomic download (302 redirect to R2 or direct stream)
 * - DELETE /f/:id: Deletes a file using its secret delete token
 * - GET /beam/:roomId: Loads the WebRTC direct peer-to-peer transfer interface
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
if (typeof process.loadEnvFile === 'function' && fs.existsSync(path.join(__dirname, '.env'))) {
  process.loadEnvFile(path.join(__dirname, '.env'));
}
const crypto = require('crypto');
const multer = require('multer');

// Internal modules
const { initDb, isPostgres } = require('./src/db');
const {
  upload,
  parseExpiry,
  MAX_FILE_SIZE,
  isR2Configured,
  getStorageProviderName,
  getPresignedUploadUrl,
  getPresignedDownloadUrl
} = require('./src/storage');
const {
  getFileById,
  getActiveFile,
  createFileRecord,
  incrementDownloadAtomic,
  deleteFileRecord,
  getFilePath,
  formatFileResponse
} = require('./src/files');
const { hashPassword, verifyPassword } = require('./src/auth');
const { uploadLimiter, downloadLimiter } = require('./src/limiter');
const { startCleanupInterval, stopCleanupInterval } = require('./src/cleanup');
const { initSignaling, rooms } = require('./src/signaling');

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

/**
 * GET /health
 * Exposes live health status, memory footprint, and active engine configuration.
 */
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    memoryRssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    activeRooms: rooms ? rooms.size : 0,
    database: isPostgres() ? 'postgresql' : 'sqlite',
    storage: getStorageProviderName(),
    timestamp: Date.now()
  });
});

/**
 * POST /upload/presign
 * Direct-to-Cloudflare R2 Presigned URL Generation (Option A - Zero Server Egress & Zero RAM).
 * 1. Checks file size and rate limits.
 * 2. Hashes password via native crypto.scryptSync (if provided).
 * 3. Pre-allocates metadata in PostgreSQL.
 * 4. Generates a 60-second S3/R2 presigned PUT URL.
 * 5. Returns presigned URL to browser for direct binary upload.
 */
app.post('/upload/presign', uploadLimiter, async (req, res) => {
  if (!isR2Configured() && process.env.NODE_ENV !== 'test') {
    return res.status(501).json({ error: 'Direct storage upload requires Cloudflare R2' });
  }

  try {
    const { filename, size, mimeType, expiry, password, max_downloads } = req.body || {};

    if (!filename || typeof filename !== 'string') {
      return res.status(400).json({ error: 'Filename is required' });
    }

    const fileSize = parseInt(size, 10);
    if (isNaN(fileSize) || fileSize <= 0) {
      return res.status(400).json({ error: 'Valid file size is required' });
    }

    if (fileSize > MAX_FILE_SIZE) {
      return res.status(413).json({ error: 'File size exceeds maximum limit of 50 MB' });
    }

    const id = crypto.randomBytes(12).toString('hex');
    const deleteToken = crypto.randomBytes(16).toString('hex');
    const cleanOriginalName = path.basename(filename);
    const fileExtension = path.extname(cleanOriginalName).slice(0, 10);
    const storedName = `${crypto.randomUUID()}${fileExtension}`;
    const cleanMimeType = mimeType || 'application/octet-stream';
    const createdAt = Date.now();
    const expiresAt = parseExpiry(expiry);
    const passwordHash = hashPassword(password);
    const maxDownloads = parseMaxDownloads(max_downloads);
    const storageType = isR2Configured() ? 'r2' : 'local';

    await createFileRecord({
      id,
      originalName: cleanOriginalName,
      storedName,
      size: fileSize,
      mimeType: cleanMimeType,
      passwordHash,
      expiresAt,
      maxDownloads,
      deleteToken,
      createdAt,
      storageType
    });

    const downloadUrl = `/f/${id}`;
    const fullUrl = buildFullUrl(req, downloadUrl);

    let uploadUrl = null;
    if (storageType === 'r2') {
      uploadUrl = await getPresignedUploadUrl({
        key: storedName,
        mimeType: cleanMimeType,
        expiresIn: 120
      });
    }

    return res.status(201).json({
      id,
      download_url: downloadUrl,
      full_url: fullUrl,
      delete_token: deleteToken,
      original_name: cleanOriginalName,
      size: fileSize,
      has_password: Boolean(passwordHash),
      expires_at: expiresAt,
      max_downloads: maxDownloads,
      storage_type: storageType,
      upload_url: uploadUrl, // Null if local fallback
      created_at: createdAt
    });
  } catch (err) {
    console.error('Error generating presigned upload:', err);
    return res.status(500).json({ error: 'Failed to initialize upload' });
  }
});

/**
 * POST /upload
 * Standard multipart/form-data upload route:
 * Used for local testing, fallback, and automated unit tests.
 */
app.post('/upload', uploadLimiter, (req, res) => {
  upload.single('file')(req, res, async (err) => {
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
      const id = crypto.randomBytes(12).toString('hex');
      const deleteToken = crypto.randomBytes(16).toString('hex');
      const originalName = path.basename(req.file.originalname);
      const storedName = req.file.filename;
      const size = req.file.size;
      const mimeType = req.file.mimetype || 'application/octet-stream';
      const createdAt = Date.now();
      const expiresAt = parseExpiry(req.body.expiry);
      const passwordHash = hashPassword(req.body.password);
      const maxDownloads = parseMaxDownloads(req.body.max_downloads);

      await createFileRecord({
        id,
        originalName,
        storedName,
        size,
        mimeType,
        passwordHash,
        expiresAt,
        maxDownloads,
        deleteToken,
        createdAt,
        storageType: 'local'
      });

      const downloadUrl = `/f/${id}`;
      const fullUrl = buildFullUrl(req, downloadUrl);

      return res.status(201).json({
        id,
        download_url: downloadUrl,
        full_url: fullUrl,
        delete_token: deleteToken,
        original_name: originalName,
        size,
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
app.get('/f/:id', downloadLimiter, async (req, res) => {
  const file = await getActiveFile(req.params.id);
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
app.post('/f/:id/verify-password', async (req, res) => {
  const file = await getActiveFile(req.params.id);
  if (!file) {
    return res.status(404).json({ error: 'File not found or link has expired' });
  }

  if (!file.password_hash) {
    return res.status(200).json({ ok: true });
  }

  const providedPassword = (req.body && req.body.password) || (req.query && req.query.password);
  if (!verifyPassword(providedPassword, file.password_hash)) {
    return res.status(403).json({ error: 'Incorrect password' });
  }

  return res.status(200).json({ ok: true });
});

/**
 * Core Download Handler function:
 * Used by both GET /f/:id/download and POST /f/:id/download.
 * 1. Validates that the file is active (not expired).
 * 2. Checks password (if required) using constant-time comparison.
 * 3. Atomically increments download count in PostgreSQL/SQLite using a single conditional UPDATE.
 * 4. Offloading: If stored on Cloudflare R2, signs a 60s presigned GET URL and issues HTTP 302.
 *               If stored locally, streams the file directly from disk.
 */
async function handleDownload(req, res) {
  const file = await getActiveFile(req.params.id);
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

  // 2. Atomic download count increment via single conditional statement
  const updatedFile = await incrementDownloadAtomic(file.id);
  if (!updatedFile) {
    return res.status(404).json({ error: 'File not found or link has expired' });
  }

  // 3. Cloudflare R2 presigned GET offloading (Two-Phase Token-Gated Pattern)
  if (file.storage_type === 'r2') {
    const presignedDownloadUrl = await getPresignedDownloadUrl({
      key: file.stored_name,
      filename: file.original_name,
      mimeType: file.mime_type,
      expiresIn: 60
    });

    if (req.headers.accept && req.headers.accept.includes('application/json') && !req.query.direct) {
      return res.status(200).json({ downloadUrl: presignedDownloadUrl });
    }
    return res.redirect(302, presignedDownloadUrl);
  }

  // 4. Local disk storage fallback
  const physicalPath = getFilePath(file.stored_name);
  if (!fs.existsSync(physicalPath)) {
    return res.status(404).json({ error: 'File not found on disk' });
  }

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
app.delete('/f/:id', async (req, res) => {
  const file = await getFileById(req.params.id);
  if (!file) {
    return res.status(404).json({ error: 'File not found or link has expired' });
  }

  const token = req.headers['x-delete-token'] || (req.query && req.query.token);
  if (!token || token !== file.delete_token) {
    return res.status(403).json({ error: 'Invalid or missing delete token' });
  }

  await deleteFileRecord(file.id);
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
