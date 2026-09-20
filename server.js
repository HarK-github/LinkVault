const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { initDb, getDb } = require('./src/db');
const { upload, parseExpiry, UPLOADS_DIR } = require('./src/storage');
const { getFileById, getFilePath, formatFileResponse } = require('./src/files');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable trust proxy for reverse proxies (Render, Cloudflare, etc.)
app.set('trust proxy', 1);

// Standard body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend assets
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint for deployment monitoring
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: Date.now() });
});

// POST /upload - Save file, insert DB row, return link and delete token
app.post('/upload', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
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
      const id = crypto.randomBytes(12).toString('hex');
      const deleteToken = crypto.randomBytes(16).toString('hex');
      const originalName = path.basename(req.file.originalname);
      const storedName = req.file.filename;
      const size = req.file.size;
      const createdAt = Date.now();
      const expiresAt = parseExpiry(req.body.expiry);

      let maxDownloads = null;
      if (req.body.max_downloads) {
        const parsed = parseInt(req.body.max_downloads, 10);
        if (!isNaN(parsed) && parsed > 0) {
          maxDownloads = parsed;
        }
      }

      const stmt = db.prepare(`
        INSERT INTO files (id, original_name, stored_name, size, password_hash, expires_at, max_downloads, downloads, delete_token, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `);

      stmt.run(id, originalName, storedName, size, null, expiresAt, maxDownloads, deleteToken, createdAt);

      const host = req.get('host');
      const protocol = req.protocol;
      const downloadUrl = `/f/${id}`;
      const fullUrl = host ? `${protocol}://${host}${downloadUrl}` : downloadUrl;

      return res.status(201).json({
        id,
        download_url: downloadUrl,
        full_url: fullUrl,
        delete_token: deleteToken,
        original_name: originalName,
        size,
        expires_at: expiresAt,
        max_downloads: maxDownloads,
        created_at: createdAt
      });
    } catch (dbErr) {
      console.error('Error saving uploaded file record:', dbErr);
      return res.status(500).json({ error: 'Failed to process file upload' });
    }
  });
});

// GET /f/:id - File info or download page
app.get('/f/:id', (req, res) => {
  const file = getFileById(req.params.id);
  if (!file) {
    return res.status(404).json({ error: 'File not found or link has expired' });
  }

  // If browser requests HTML page, serve the UI index.html
  if (req.accepts('html') && !req.xhr && !req.headers['x-requested-with']) {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(indexPath)) {
      return res.sendFile(indexPath);
    }
  }

  return res.status(200).json(formatFileResponse(file));
});

// POST /f/:id/download - Stream file with original filename
app.post('/f/:id/download', (req, res) => {
  const file = getFileById(req.params.id);
  if (!file) {
    return res.status(404).json({ error: 'File not found or link has expired' });
  }

  const filePath = getFilePath(file.stored_name);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found on disk' });
  }

  return res.download(filePath, file.original_name);
});

// Initialize database
initDb();

let server = null;
if (require.main === module) {
  server = app.listen(PORT, () => {
    console.log(`LinkVault server listening on port ${PORT}`);
  });

  const shutdown = () => {
    console.log('Shutting down server gracefully...');
    if (server) {
      server.close(() => {
        console.log('HTTP server closed.');
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = app;
