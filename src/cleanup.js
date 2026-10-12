const { getDb } = require('./db');
const { getFilePath, removeFileFromDisk } = require('./files');

function runCleanupJob() {
  try {
    const db = getDb();
    const now = Date.now();
    const expired = db.prepare(`
      SELECT id, stored_name FROM files 
      WHERE expires_at <= ? OR (max_downloads IS NOT NULL AND downloads >= max_downloads)
    `).all(now);

    if (expired.length === 0) return 0;

    for (const file of expired) {
      removeFileFromDisk(getFilePath(file.stored_name));
    }

    const result = db.prepare(`
      DELETE FROM files 
      WHERE expires_at <= ? OR (max_downloads IS NOT NULL AND downloads >= max_downloads)
    `).run(now);

    console.log(`[Cleanup] Removed ${result.changes} expired/used-up file(s).`);
    return result.changes;
  } catch (error) {
    console.error('[Cleanup] Error during file cleanup run:', error.message);
    return 0;
  }
}

let cleanupTimer = null;

function startCleanupInterval(intervalMs = 10 * 60 * 1000) {
  if (cleanupTimer) clearInterval(cleanupTimer);
  runCleanupJob();
  cleanupTimer = setInterval(runCleanupJob, intervalMs);
  if (cleanupTimer.unref) cleanupTimer.unref();
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

