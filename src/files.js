/**
 * LinkVault - File Record and Database Query Operations
 *
 * This module handles all database reads and writes for uploaded files,
 * including checking expiration dates, atomic download counting,
 * and deleting files from both the disk and database.
 */

const path = require('path');
const fs = require('fs');
const { getDb } = require('./db');
const { UPLOADS_DIR } = require('./storage');

/**
 * Returns the full absolute path of a stored file on the filesystem.
 *
 * @param {string} storedName - The random filename assigned when saved on disk.
 * @returns {string} Full filesystem path (e.g. /app/uploads/abc-123.pdf).
 */
function getFilePath(storedName) {
  return path.join(UPLOADS_DIR, storedName);
}

/**
 * Safely removes a file from the server's filesystem if it exists.
 * Does not throw an error if the file was already deleted.
 *
 * @param {string} fullPath - The absolute path of the file to remove.
 */
function removeFileFromDisk(fullPath) {
  try {
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  } catch (err) {
    console.error(`Failed to delete file from disk (${fullPath}):`, err.message);
  }
}

/**
 * Deletes a file record from the database AND removes its file from disk.
 *
 * @param {string} id - The unique file ID.
 * @returns {boolean} True if the record was found and deleted, false otherwise.
 */
function deleteFileRecord(id) {
  const db = getDb();

  // 1. Look up the stored disk filename before deleting the row
  const selectQuery = db.prepare('SELECT stored_name FROM files WHERE id = ?');
  const fileRecord = selectQuery.get(id);

  // 2. If the file exists, delete it from the hard drive
  if (fileRecord) {
    const fullPath = getFilePath(fileRecord.stored_name);
    removeFileFromDisk(fullPath);
  }

  // 3. Delete the row from the database
  const deleteQuery = db.prepare('DELETE FROM files WHERE id = ?');
  const result = deleteQuery.run(id);

  // result.changes is the number of rows deleted (1 if successful, 0 if not found)
  return result.changes > 0;
}

/**
 * Retrieves a file record from the database by its ID, regardless of whether
 * it is expired or has reached its download limit.
 *
 * @param {string} id - The unique file ID.
 * @returns {object|null} The database row object, or null if not found.
 */
function getFileById(id) {
  const db = getDb();
  const selectQuery = db.prepare('SELECT * FROM files WHERE id = ?');
  const file = selectQuery.get(id);

  if (!file) {
    return null;
  }
  return file;
}

/**
 * Retrieves a file ONLY if it is still valid and active:
 * 1. Checks if the file exists in the database.
 * 2. Checks if the expiration timestamp has passed (if expired, automatically deletes it).
 * 3. Checks if the maximum download limit has already been reached.
 *
 * @param {string} id - The unique file ID.
 * @returns {object|null} The active file record, or null if invalid/expired.
 */
function getActiveFile(id) {
  const file = getFileById(id);

  // 1. If file does not exist at all
  if (!file) {
    return null;
  }

  // 2. Check if the link has expired
  const currentTime = Date.now();
  if (file.expires_at <= currentTime) {
    // Clean up expired file immediately
    deleteFileRecord(id);
    return null;
  }

  // 3. Check if download limit has already been reached
  const hasDownloadLimit = file.max_downloads !== null;
  if (hasDownloadLimit && file.downloads >= file.max_downloads) {
    return null;
  }

  return file;
}

/**
 * Atomically increments the download counter in the database.
 *
 * Why ATOMIC?
 * If two users click download at the exact same millisecond when max_downloads is 1,
 * doing a simple (SELECT then UPDATE) would allow BOTH users to download.
 * By putting "WHERE (max_downloads IS NULL OR downloads < max_downloads)"
 * directly inside the single SQL statement, SQLite guarantees only ONE update succeeds.
 *
 * @param {string} id - The unique file ID.
 * @returns {boolean} True if the counter was incremented, false if limit was reached.
 */
function incrementDownloadAtomic(id) {
  const db = getDb();
  const updateQuery = db.prepare(`
    UPDATE files
    SET downloads = downloads + 1
    WHERE id = ? AND (max_downloads IS NULL OR downloads < max_downloads)
  `);

  const result = updateQuery.run(id);

  // If changes === 1, the increment succeeded and the download is permitted.
  // If changes === 0, the download limit was already reached by a concurrent request.
  return result.changes > 0;
}

/**
 * Formats a raw database row into a safe, client-facing JSON object.
 * Strips out sensitive fields such as stored_name, delete_token, and password_hash.
 *
 * @param {object|null} file - Raw database row object.
 * @returns {object|null} Sanitized metadata object for the client.
 */
function formatFileResponse(file) {
  if (!file) {
    return null;
  }

  // Calculate remaining downloads if there is a limit
  let remainingDownloads = null;
  if (file.max_downloads !== null) {
    remainingDownloads = Math.max(0, file.max_downloads - file.downloads);
  }

  return {
    id: file.id,
    original_name: file.original_name,
    size: file.size,
    expires_at: file.expires_at,
    max_downloads: file.max_downloads,
    downloads: file.downloads,
    remaining_downloads: remainingDownloads,
    has_password: Boolean(file.password_hash),
    created_at: file.created_at
  };
}

module.exports = {
  getFilePath,
  getFileById,
  getActiveFile,
  incrementDownloadAtomic,
  deleteFileRecord,
  formatFileResponse
};
