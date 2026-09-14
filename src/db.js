const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let dbInstance = null;

function initDb(dbPath) {
  const resolvedPath = dbPath || process.env.DB_PATH || path.join(__dirname, '..', 'linkvault.db');
  
  if (resolvedPath !== ':memory:') {
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(resolvedPath);
  
  // Enable WAL mode for high concurrency and performance
  if (resolvedPath !== ':memory:') {
    db.pragma('journal_mode = WAL');
  }
  db.pragma('foreign_keys = ON');

  // Schema as defined in project plan
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      size INTEGER NOT NULL,
      password_hash TEXT,
      expires_at INTEGER NOT NULL,
      max_downloads INTEGER,
      downloads INTEGER NOT NULL DEFAULT 0,
      delete_token TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_files_expires_at ON files (expires_at);
    CREATE INDEX IF NOT EXISTS idx_files_delete_token ON files (delete_token);
  `);

  dbInstance = db;
  return db;
}

function getDb() {
  if (!dbInstance) {
    dbInstance = initDb();
  }
  return dbInstance;
}

function closeDb() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

module.exports = {
  initDb,
  getDb,
  closeDb
};
