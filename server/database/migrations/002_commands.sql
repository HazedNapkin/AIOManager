-- Migration 002: Server-side command queue jobs (Phase 1b of the command-queue rearchitecture)
-- Target: persistent job records for POST /api/commands (protect-all / unprotect-all proof commands)
--
-- The functional, dialect-safe creation path is ensureTable('commands', ...) in
-- server/database/setup.js (idempotent, column-add aware, sqlite + postgres). This file
-- documents the same DDL for DBAs running migrations by hand; it uses only syntax valid
-- in BOTH sqlite and postgres (BIGINT, TEXT, CREATE INDEX IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS commands (
  id TEXT PRIMARY KEY,
  sync_user TEXT NOT NULL,
  command TEXT NOT NULL,
  account_ids TEXT NOT NULL,
  status TEXT NOT NULL,
  results TEXT,
  error TEXT,
  created_at BIGINT NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL DEFAULT 0
);

-- Job lookups are always (id, sync_user) scoped; status scans power boot cleanup.
CREATE INDEX IF NOT EXISTS idx_commands_user_updated ON commands (sync_user, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_commands_status ON commands (status);
