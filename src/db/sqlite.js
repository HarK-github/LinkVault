/**
 * LinkVault - SQLite Database Adapter (Local Development Fallback)
 * Uses better-sqlite3 with WAL mode for zero-setup local development and unit tests.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let dbInstance = null;

function ensureDirectoryExists(filePath) {
  if (filePath !== ':memory:') {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }
}

function createTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      size INTEGER NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      password_hash TEXT,
      expires_at INTEGER NOT NULL,
      max_downloads INTEGER,
      downloads INTEGER NOT NULL DEFAULT 0,
      delete_token TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      storage_type TEXT NOT NULL DEFAULT 'local'
    );

    CREATE INDEX IF NOT EXISTS idx_files_expires_at ON files (expires_at);
    CREATE INDEX IF NOT EXISTS idx_files_delete_token ON files (delete_token);
    CREATE INDEX IF NOT EXISTS idx_files_downloads ON files (downloads, max_downloads);
  `);

  // Ensure mime_type and storage_type columns exist on older databases
  try {
    const columns = db.pragma('table_info(files)');
    const colNames = columns.map(c => c.name);
    if (!colNames.includes('mime_type')) {
      db.exec("ALTER TABLE files ADD COLUMN mime_type TEXT NOT NULL DEFAULT 'application/octet-stream'");
    }
    if (!colNames.includes('storage_type')) {
      db.exec("ALTER TABLE files ADD COLUMN storage_type TEXT NOT NULL DEFAULT 'local'");
    }
  } catch (err) {}
}

function initSqlite(customPath) {
  if (dbInstance) return dbInstance;

  let resolvedPath = path.join(__dirname, '..', '..', 'linkvault.db');
  if (customPath) {
    resolvedPath = customPath;
  } else if (process.env.DB_PATH) {
    resolvedPath = process.env.DB_PATH;
  }

  ensureDirectoryExists(resolvedPath);
  const db = new Database(resolvedPath);

  if (resolvedPath !== ':memory:') {
    db.pragma('journal_mode = WAL');
  }
  db.pragma('foreign_keys = ON');

  createTables(db);
  dbInstance = db;
  return db;
}

/**
 * Translates $1, $2 placeholders to ? for SQLite and executes query.
 */
function query(text, params = []) {
  if (!dbInstance) initSqlite();

  // Convert PostgreSQL $1, $2, etc. placeholders to SQLite ?
  const sqliteSql = text.replace(/\$\d+/g, '?');
  const trimmed = sqliteSql.trim();

  // If query returns rows (SELECT or UPDATE ... RETURNING)
  if (/^(SELECT|PRAGMA)/i.test(trimmed)) {
    const stmt = dbInstance.prepare(sqliteSql);
    const rows = stmt.all(...params);
    return { rows, rowCount: rows.length };
  }

  // Handle RETURNING clause in SQLite (supported in better-sqlite3)
  if (/RETURNING/i.test(trimmed)) {
    const stmt = dbInstance.prepare(sqliteSql);
    const rows = stmt.all(...params);
    return { rows, rowCount: rows.length };
  }

  // Non-returning statements (INSERT, UPDATE, DELETE)
  const stmt = dbInstance.prepare(sqliteSql);
  const info = stmt.run(...params);
  return { rows: [], rowCount: info.changes };
}

function closeSqlite() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

function getSqliteInstance() {
  if (!dbInstance) initSqlite();
  return dbInstance;
}

module.exports = {
  initSqlite,
  query,
  closeSqlite,
  getSqliteInstance
};
