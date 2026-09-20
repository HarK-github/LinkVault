const path = require('path');
const fs = require('fs');
const { getDb } = require('./db');
const { UPLOADS_DIR } = require('./storage');

function getFilePath(storedName) {
  return path.join(UPLOADS_DIR, storedName);
}

function getFileById(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM files WHERE id = ?').get(id);
}

function deleteFileRecord(id) {
  const db = getDb();
  const file = db.prepare('SELECT stored_name FROM files WHERE id = ?').get(id);
  
  if (file) {
    const fullPath = getFilePath(file.stored_name);
    try {
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    } catch (err) {
      console.error(`Failed to unlink file ${fullPath}:`, err.message);
    }
  }

  const result = db.prepare('DELETE FROM files WHERE id = ?').run(id);
  return result.changes > 0;
}

function formatFileResponse(file) {
  if (!file) return null;
  return {
    id: file.id,
    original_name: file.original_name,
    size: file.size,
    expires_at: file.expires_at,
    max_downloads: file.max_downloads,
    downloads: file.downloads,
    remaining_downloads: file.max_downloads !== null ? Math.max(0, file.max_downloads - file.downloads) : null,
    has_password: Boolean(file.password_hash),
    created_at: file.created_at
  };
}

module.exports = {
  getFilePath,
  getFileById,
  deleteFileRecord,
  formatFileResponse
};
