/**
 * LinkVault - PostgreSQL Connection Pool & Execution Manager
 * Handles connection pooling via `pg.Pool` for managed Postgres (Neon, Supabase, Render).
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

let pool = null;

/**
 * Initializes the PostgreSQL connection pool.
 * Supports connection strings (DATABASE_URL) and individual PG environment variables.
 */
function initPostgres(connectionString) {
  if (pool) return pool;

  const connStr = connectionString || process.env.DATABASE_URL;
  const isSslRequired = Boolean(
    connStr && (connStr.includes('sslmode=require') || !connStr.includes('localhost'))
  );

  pool = new Pool({
    connectionString: connStr,
    ssl: isSslRequired ? { rejectUnauthorized: false } : false,
    max: parseInt(process.env.PG_MAX_POOL || '20', 10), // Matches 20 parallel worker benchmark
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  });

  pool.on('error', (err) => {
    console.error('[PostgreSQL] Unexpected client pool error:', err.message);
  });

  return pool;
}

/**
 * Auto-creates schema tables if they don't already exist.
 */
async function autoMigratePostgres() {
  if (!pool) return;
  const schemaPath = path.join(__dirname, '..', '..', 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    const ddl = fs.readFileSync(schemaPath, 'utf8');
    await pool.query(ddl);
  }
}

/**
 * Executes a parameterized SQL query against the PostgreSQL pool.
 *
 * @param {string} text - SQL query with $1, $2 placeholders
 * @param {Array} params - Query parameters
 * @returns {Promise<{rows: Array, rowCount: number}>}
 */
async function query(text, params = []) {
  if (!pool) initPostgres();
  const res = await pool.query(text, params);
  return {
    rows: res.rows,
    rowCount: res.rowCount
  };
}

/**
 * Safely closes all pooled connections on server shutdown.
 */
async function closePostgres() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

function getPool() {
  return pool;
}

module.exports = {
  initPostgres,
  autoMigratePostgres,
  query,
  closePostgres,
  getPool
};
