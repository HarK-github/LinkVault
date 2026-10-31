-- LinkVault PostgreSQL Schema
-- Used for production deployments on Neon, Supabase, or Render PostgreSQL.

CREATE TABLE IF NOT EXISTS files (
  id VARCHAR(36) PRIMARY KEY,
  original_name VARCHAR(255) NOT NULL,
  stored_name VARCHAR(255) NOT NULL,
  size BIGINT NOT NULL,
  mime_type VARCHAR(127) NOT NULL DEFAULT 'application/octet-stream',
  password_hash VARCHAR(255),
  expires_at BIGINT NOT NULL,
  max_downloads INTEGER,
  downloads INTEGER NOT NULL DEFAULT 0,
  delete_token VARCHAR(255) NOT NULL,
  created_at BIGINT NOT NULL,
  storage_type VARCHAR(32) NOT NULL DEFAULT 'r2' -- 'r2' or 'local'
);

CREATE INDEX IF NOT EXISTS idx_files_expires_at ON files (expires_at);
CREATE INDEX IF NOT EXISTS idx_files_delete_token ON files (delete_token);
CREATE INDEX IF NOT EXISTS idx_files_downloads ON files (downloads, max_downloads);
