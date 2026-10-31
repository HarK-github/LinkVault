const { getDb, isPostgres, query, execute } = require('./db');
const { getFilePath, removeFileFromDisk } = require('./files');
const { deleteR2Objects } = require('./storage/r2');

function runCleanupJobSqlite() {
  try {
    const db = getDb();
    const now = Date.now();
    const expired = db.prepare(`
      SELECT id, stored_name, storage_type FROM files 
      WHERE expires_at <= ? OR (max_downloads IS NOT NULL AND downloads >= max_downloads)
    `).all(now);

    if (expired.length === 0) return 0;

    const r2Keys = [];
    for (const file of expired) {
      if (file.storage_type === 'r2') {
        r2Keys.push(file.stored_name);
      } else {
        removeFileFromDisk(getFilePath(file.stored_name));
      }
    }
    if (r2Keys.length > 0) {
      deleteR2Objects(r2Keys).catch(err => console.error('[Cleanup R2 Error]:', err.message));
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

async function runCleanupJobPostgres() {
  try {
    const now = Date.now();
    const expiredRes = await query(`
      SELECT id, stored_name, storage_type FROM files
      WHERE expires_at <= $1 OR (max_downloads IS NOT NULL AND downloads >= max_downloads)
    `, [now]);

    const expired = expiredRes.rows;
    if (expired.length === 0) return 0;

    const r2Keys = [];
    for (const file of expired) {
      if (file.storage_type === 'r2') {
        r2Keys.push(file.stored_name);
      } else {
        removeFileFromDisk(getFilePath(file.stored_name));
      }
    }
    if (r2Keys.length > 0) {
      await deleteR2Objects(r2Keys);
    }

    const deleteCount = await execute(`
      DELETE FROM files
      WHERE expires_at <= $1 OR (max_downloads IS NOT NULL AND downloads >= max_downloads)
    `, [now]);

    console.log(`[Cleanup] Removed ${deleteCount} expired/used-up file(s).`);
    return deleteCount;
  } catch (error) {
    console.error('[Cleanup] Error during file cleanup run:', error.message);
    return 0;
  }
}

function runCleanupJob() {
  if (isPostgres()) {
    return runCleanupJobPostgres();
  }
  return runCleanupJobSqlite();
}

let cleanupTimer = null;

function startCleanupInterval(intervalMs = 10 * 60 * 1000) {
  if (cleanupTimer) clearInterval(cleanupTimer);
  runCleanupJob();
  cleanupTimer = setInterval(() => {
    runCleanupJob();
  }, intervalMs);
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
