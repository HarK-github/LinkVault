/**
 * LinkVault - File Record and Database Query Operations
 *
 * Handles database access across PostgreSQL and SQLite,
 * including single-statement atomic download caps, expiration verification,
 * and deleting files from Cloudflare R2 and local disk.
 */

const path = require('path');
const fs = require('fs');
const { query, queryOne, execute } = require('./db');
const { UPLOADS_DIR } = require('./storage');
const { deleteR2Object } = require('./storage/r2');

/**
 * Returns the full absolute path of a stored local file.
 */
function getFilePath(storedName) {
  return path.join(UPLOADS_DIR, storedName);
}

/**
 * Safely removes a file from the server filesystem if it exists.
 */
function removeFileFromDisk(fullPath) {
  try {
    fs.rmSync(fullPath, { force: true });
  } catch (err) {
    console.error(`Failed to delete file from disk (${fullPath}):`, err.message);
  }
}

/**
 * Creates a new file record in the database.
 */
async function createFileRecord({
  id,
  originalName,
  storedName,
  size,
  mimeType = 'application/octet-stream',
  passwordHash = null,
  expiresAt,
  maxDownloads = null,
  deleteToken,
  createdAt = Date.now(),
  storageType = 'local'
}) {
  const sql = `
    INSERT INTO files (
      id, original_name, stored_name, size, mime_type, password_hash,
      expires_at, max_downloads, downloads, delete_token, created_at, storage_type
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, $10, $11)
  `;

  await execute(sql, [
    id, originalName, storedName, size, mimeType, passwordHash,
    expiresAt, maxDownloads, deleteToken, createdAt, storageType
  ]);

  return {
    id, originalName, storedName, size, mimeType,
    expiresAt, maxDownloads, deleteToken, createdAt, storageType
  };
}

/**
 * Deletes a file record from the database AND removes binary storage (R2 or local disk).
 *
 * @param {string} id - Unique file identifier
 * @returns {Promise<boolean>} True if found and deleted
 */
async function deleteFileRecord(id) {
  const fileRecord = await queryOne('SELECT stored_name, storage_type FROM files WHERE id = $1', [id]);

  if (fileRecord) {
    if (fileRecord.storage_type === 'r2') {
      await deleteR2Object(fileRecord.stored_name);
    } else {
      const fullPath = getFilePath(fileRecord.stored_name);
      removeFileFromDisk(fullPath);
    }
  }

  const deletedCount = await execute('DELETE FROM files WHERE id = $1', [id]);
  return deletedCount > 0;
}

/**
 * Retrieves a file record by its ID without validity checks.
 *
 * @param {string} id
 * @returns {Promise<object|null>}
 */
async function getFileById(id) {
  return queryOne('SELECT * FROM files WHERE id = $1', [id]);
}

/**
 * Retrieves an active file record:
 * - Checks existence
 * - Checks expiration (if expired, automatically triggers deletion)
 * - Checks download caps
 *
 * @param {string} id
 * @returns {Promise<object|null>}
 */
async function getActiveFile(id) {
  const file = await getFileById(id);
  if (!file) return null;

  const now = Date.now();
  if (Number(file.expires_at) <= now) {
    await deleteFileRecord(id);
    return null;
  }

  const hasLimit = file.max_downloads !== null && file.max_downloads !== undefined;
  if (hasLimit && Number(file.downloads) >= Number(file.max_downloads)) {
    return null;
  }

  return file;
}

/**
 * Atomically increments the download counter using a single SQL conditional statement.
 *
 * Concurrency Control:
 * "UPDATE ... WHERE id = $1 AND downloads < max_downloads AND expires_at > $2 RETURNING *"
 * PostgreSQL row-level locks and SQLite WAL write serialization guarantee that exactly
 * ONE query increments the counter when competing threads arrive simultaneously.
 *
 * @param {string} id - Unique file identifier
 * @returns {Promise<object|null>} Updated file record if permitted, null if limit reached
 */
async function incrementDownloadAtomic(id) {
  const now = Date.now();
  const sql = `
    UPDATE files
    SET downloads = downloads + 1
    WHERE id = $1
      AND (max_downloads IS NULL OR downloads < max_downloads)
      AND expires_at > $2
    RETURNING *
  `;

  const updatedFile = await queryOne(sql, [id, now]);
  return updatedFile; // Returns object if succeeded (rowCount === 1), null if cap reached (rowCount === 0)
}

/**
 * Formats a raw database row into a safe client-facing JSON payload.
 */
function formatFileResponse(file) {
  if (!file) return null;

  let remainingDownloads = null;
  if (file.max_downloads !== null && file.max_downloads !== undefined) {
    remainingDownloads = Math.max(0, Number(file.max_downloads) - Number(file.downloads));
  }

  return {
    id: file.id,
    original_name: file.original_name,
    size: Number(file.size),
    mime_type: file.mime_type || 'application/octet-stream',
    expires_at: Number(file.expires_at),
    max_downloads: file.max_downloads !== null ? Number(file.max_downloads) : null,
    downloads: Number(file.downloads),
    remaining_downloads: remainingDownloads,
    has_password: Boolean(file.password_hash),
    storage_type: file.storage_type || 'local',
    created_at: Number(file.created_at)
  };
}

module.exports = {
  getFilePath,
  removeFileFromDisk,
  createFileRecord,
  getFileById,
  getActiveFile,
  incrementDownloadAtomic,
  deleteFileRecord,
  formatFileResponse
};
