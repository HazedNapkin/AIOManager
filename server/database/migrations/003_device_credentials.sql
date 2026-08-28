-- Migration 003: Remembered-device credentials ("Remember this device", issue #36)
-- Target: per-device unlock credentials for the AIOManager login layer
--
-- The functional, dialect-safe creation path is ensureTable('device_credentials', ...)
-- in server/database/setup.js (idempotent, column-add aware, sqlite + postgres), which
-- also adds kv_store.credential_epoch for both dialects. This file documents the same
-- DDL for DBAs running migrations by hand; it uses only syntax valid in BOTH sqlite
-- and postgres (BIGINT, TEXT, CHECK, CREATE INDEX IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS device_credentials (
  id TEXT PRIMARY KEY,
  account_uuid TEXT NOT NULL,
  device_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('idb', 'prf')),
  label TEXT,
  created_at BIGINT NOT NULL DEFAULT 0,
  expires_at BIGINT NOT NULL DEFAULT 0,
  revoked INTEGER NOT NULL DEFAULT 0,
  last_used_at BIGINT,
  credential_epoch INTEGER NOT NULL DEFAULT 1
);

-- One credential slot per (account, device); enrollment replaces it in place.
CREATE UNIQUE INDEX IF NOT EXISTS idx_device_credentials_account_device ON device_credentials (account_uuid, device_id);
CREATE INDEX IF NOT EXISTS idx_device_credentials_account ON device_credentials (account_uuid);

-- Sign-out-everywhere / password-change generation counter lives on the account row.
-- sqlite has no ADD COLUMN IF NOT EXISTS; setup.js guards it with PRAGMA table_info.
-- ALTER TABLE kv_store ADD COLUMN credential_epoch INTEGER NOT NULL DEFAULT 1;
