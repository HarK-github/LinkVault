/**
 * LinkVault - Pluggable Database Tier
 * Seamlessly toggles between PostgreSQL (production with DATABASE_URL)
 * and SQLite (local development / testing without credentials).
 */

const postgres = require('./postgres');
const sqlite = require('./sqlite');

function isPostgres() {
  return Boolean(process.env.DATABASE_URL && process.env.NODE_ENV !== 'test');
}

/**
 * Initializes the active database backend.
 */
async function initDb(customPath) {
  if (isPostgres()) {
    postgres.initPostgres();
    await postgres.autoMigratePostgres();
    console.log('[Database] Connected to PostgreSQL with connection pool');
    return postgres.getPool();
  } else {
    const db = sqlite.initSqlite(customPath);
    console.log('[Database] Using local SQLite storage engine (WAL mode)');
    return db;
  }
}

/**
 * Executes a parameterized query across PostgreSQL or SQLite.
 *
 * @param {string} text - SQL query with $1, $2 placeholders
 * @param {Array} params - Array of parameter values
 * @returns {Promise<{rows: Array, rowCount: number}>}
 */
async function query(text, params = []) {
  if (isPostgres()) {
    return postgres.query(text, params);
  }
  return sqlite.query(text, params);
}

/**
 * Helper to fetch a single row or null.
 */
async function queryOne(text, params = []) {
  const result = await query(text, params);
  return result.rows[0] || null;
}

/**
 * Helper to execute an INSERT/UPDATE/DELETE and return modified row count.
 */
async function execute(text, params = []) {
  const result = await query(text, params);
  return result.rowCount;
}

/**
 * Safely closes active connections on shutdown or test teardown.
 */
async function closeDb() {
  if (isPostgres()) {
    await postgres.closePostgres();
  } else {
    sqlite.closeSqlite();
  }
}

/**
 * Returns raw database instance/pool for legacy tests or low-level operations.
 */
function getDb() {
  if (isPostgres()) {
    return postgres.getPool() || postgres.initPostgres();
  }
  return sqlite.getSqliteInstance();
}

module.exports = {
  isPostgres,
  initDb,
  query,
  queryOne,
  execute,
  closeDb,
  getDb
};
