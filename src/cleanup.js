/**
 * LinkVault - Automatic File Cleanup Engine
 *
 * This background worker automatically deletes files that have passed their
 * expiration time, or have reached their maximum download limit.
 * It deletes both the file on disk (freeing storage space) and its row in SQLite.
 */

const fs = require('fs');
const { getDb } = require('./db');
const { getFilePath } = require('./files');

/**
 * Delete a single physical file from the server's hard drive.
 *
 * @param {string} fullPath - The absolute file path on disk
 */
function deletePhysicalFile(fullPath) {
  try {
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  } catch (error) {
    console.error(`[Cleanup] Failed to delete disk file: ${fullPath}`, error.message);
  }
}

/**
 * Query the database to find all files that have expired or reached their download limit.
 *
 * @param {object} db - The active SQLite database connection
 * @param {number} currentTime - Current timestamp in milliseconds
 * @returns {Array} - List of file records containing { id, stored_name }
 */
function findExpiredFiles(db, currentTime) {
  const query = `
    SELECT id, stored_name FROM files 
    WHERE expires_at <= ? 
       OR (max_downloads IS NOT NULL AND downloads >= max_downloads)
  `;
  return db.prepare(query).all(currentTime);
}

/**
 * Delete expired or exhausted file records from the database table.
 *
 * @param {object} db - The active SQLite database connection
 * @param {number} currentTime - Current timestamp in milliseconds
 * @returns {number} - The number of rows deleted
 */
function deleteExpiredDatabaseRecords(db, currentTime) {
  const query = `
    DELETE FROM files 
    WHERE expires_at <= ? 
       OR (max_downloads IS NOT NULL AND downloads >= max_downloads)
  `;
  const result = db.prepare(query).run(currentTime);
  return result.changes;
}

/**
 * Run one complete pass of the cleanup job:
 * 1. Find all expired/exhausted files in the database.
 * 2. Delete each physical file from the uploads folder.
 * 3. Delete the corresponding rows from the database.
 *
 * @returns {number} - The number of files cleaned up
 */
function runCleanupJob() {
  try {
    const db = getDb();
    const currentTime = Date.now();

    // Step 1: Find which files need to be removed
    const filesToRemove = findExpiredFiles(db, currentTime);

    if (filesToRemove.length === 0) {
      return 0;
    }

    // Step 2: Delete each file from the disk storage
    for (let i = 0; i < filesToRemove.length; i++) {
      const file = filesToRemove[i];
      const diskPath = getFilePath(file.stored_name);
      deletePhysicalFile(diskPath);
    }

    // Step 3: Remove the database rows
    const deletedCount = deleteExpiredDatabaseRecords(db, currentTime);
    console.log(`[Cleanup] Removed ${deletedCount} expired/used-up file(s).`);

    return deletedCount;
  } catch (error) {
    console.error('[Cleanup] Error during file cleanup run:', error.message);
    return 0;
  }
}

// Stores the active timer so we can start or stop it
let cleanupTimer = null;

/**
 * Start running the cleanup job periodically in the background.
 *
 * @param {number} intervalMs - How often to check for expired files (default: 10 minutes)
 * @returns {object} - The NodeJS timer object
 */
function startCleanupInterval(intervalMs = 10 * 60 * 1000) {
  // Clear any existing timer to avoid duplicate runs
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
  }

  // Run once immediately when the server boots
  runCleanupJob();

  // Schedule to run every intervalMs (e.g., every 10 minutes)
  cleanupTimer = setInterval(runCleanupJob, intervalMs);

  // unref() ensures this background interval does not prevent Node from shutting down cleanly
  if (cleanupTimer.unref) {
    cleanupTimer.unref();
  }

  return cleanupTimer;
}

/**
 * Stop the background cleanup timer when the server shuts down.
 */
function stopCleanupInterval() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

module.exports = {
  runCleanupJob,
  startCleanupInterval,
  stopCleanupInterval
};
