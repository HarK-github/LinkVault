/**
 * LinkVault - SQLite Database Initialization and Management
 *
 * This file sets up and manages the SQLite database for LinkVault.
 * SQLite stores all file metadata inside a single local file (e.g. linkvault.db),
 * which means we don't need to run a separate database server like PostgreSQL or MySQL.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// We hold a single active database connection (Singleton pattern)
// so the entire server shares the same connection instead of opening new ones.
let dbInstance = null;

function ensureDatabaseDirectoryExists(filePath) {
  if (filePath !== ':memory:') {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }
}

/**
 * Creates the required tables and indexes if they do not already exist.
 *
 * Table columns explained:
 * - id: Unique string identifier for the file (used in shareable link)
 * - original_name: Original filename uploaded by the user
 * - stored_name: Random secure filename saved on disk in /uploads
 * - size: File size in bytes
 * - password_hash: Encrypted password string (or null if unprotected)
 * - expires_at: Timestamp (milliseconds) when the link stops working
 * - max_downloads: Maximum allowed downloads (or null for unlimited)
 * - downloads: How many times the file has been downloaded so far
 * - delete_token: Secret token allowing the uploader to delete early
 * - created_at: Timestamp (milliseconds) when the file was uploaded
 *
 * Indexes:
 * - idx_files_expires_at: Speeds up finding expired files during cleanup
 * - idx_files_delete_token: Speeds up deleting a file by secret token
 *
 * @param {object} db - The active better-sqlite3 database instance.
 */
function createTablesAndIndexes(db) {
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
}

/**
 * Initializes the SQLite database connection, enables optimizations,
 * and sets up tables.
 *
 * @param {string} [customPath] - Optional custom path (useful for testing or in-memory ':memory:')
 * @returns {object} The connected better-sqlite3 database instance.
 */
function initDb(customPath) {
  // Determine path: priority is argument > environment variable > default file
  let resolvedPath = path.join(__dirname, '..', 'linkvault.db');
  if (customPath) {
    resolvedPath = customPath;
  } else if (process.env.DB_PATH) {
    resolvedPath = process.env.DB_PATH;
  }

  // 1. Ensure folder exists
  ensureDatabaseDirectoryExists(resolvedPath);

  // 2. Open the SQLite database
  const db = new Database(resolvedPath);

  // 3. Configure performance pragmas:
  // WAL (Write-Ahead Logging) allows concurrent reads while a write is occurring,
  // preventing database locks during simultaneous uploads and downloads.
  if (resolvedPath !== ':memory:') {
    db.pragma('journal_mode = WAL');
  }
  db.pragma('foreign_keys = ON');

  // 4. Create database schema
  createTablesAndIndexes(db);

  // Cache instance for subsequent calls
  dbInstance = db;
  return db;
}

/**
 * Returns the currently active database connection.
 * If the database has not been initialized yet, it initializes it automatically.
 *
 * @returns {object} Active database instance.
 */
function getDb() {
  if (dbInstance === null) {
    dbInstance = initDb();
  }
  return dbInstance;
}

/**
 * Safely closes the database connection.
 * Useful during graceful server shutdown or when tearing down unit tests.
 */
function closeDb() {
  if (dbInstance !== null) {
    dbInstance.close();
    dbInstance = null;
  }
}

module.exports = {
  initDb,
  getDb,
  closeDb
};
