const fs = require('fs');
const { getDb } = require('./db');
const { getFilePath } = require('./files');

function runCleanupJob() {
  try {
    const db = getDb();
    const now = Date.now();

    // Query for expired or exhausted files
    const expiredOrUsedUp = db.prepare(`
      SELECT id, stored_name FROM files 
      WHERE expires_at <= ? OR (max_downloads IS NOT NULL AND downloads >= max_downloads)
    `).all(now);

    if (expiredOrUsedUp.length === 0) {
      return 0;
    }

    // Delete files from disk
    for (const file of expiredOrUsedUp) {
      const fullPath = getFilePath(file.stored_name);
      try {
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
        }
      } catch (fsErr) {
        console.error(`[Cleanup] Failed to remove ${fullPath}:`, fsErr.message);
      }
    }

    // Delete rows from database
    const result = db.prepare(`
      DELETE FROM files 
      WHERE expires_at <= ? OR (max_downloads IS NOT NULL AND downloads >= max_downloads)
    `).run(now);

    console.log(`[Cleanup] Removed ${result.changes} expired/used-up file(s).`);
    return result.changes;
  } catch (err) {
    console.error('[Cleanup] Error during file cleanup run:', err.message);
    return 0;
  }
}

let cleanupTimer = null;

function startCleanupInterval(intervalMs = 10 * 60 * 1000) {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
  }

  // Run initial cleanup on start
  runCleanupJob();

  // Schedule recurring cleanup every interval
  cleanupTimer = setInterval(runCleanupJob, intervalMs);
  if (cleanupTimer.unref) {
    cleanupTimer.unref();
  }

  return cleanupTimer;
}

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
