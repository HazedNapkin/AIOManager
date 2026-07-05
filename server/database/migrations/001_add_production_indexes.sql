-- Migration 001: Add production-scale indexes for 10K+ rules, 100K+ users
-- Target: Performance optimization for hot database queries
-- Estimated impact: 10-15x performance improvement on hot queries

-- CRITICAL: Hot query for activity analytics - item_id filtering without timestamp
CREATE INDEX IF NOT EXISTS idx_activity_events_item_id ON activity_events (item_id);

-- CRITICAL: Hot query for user filtering (activity/engine.js:166-173)
CREATE INDEX IF NOT EXISTS idx_activity_events_user_only ON activity_events (sync_user);

-- CRITICAL: Hot query for sync routes (routes/sync.js:412) - canonical addon retrieval
CREATE INDEX IF NOT EXISTS idx_canonical_addons_sync_user_updated ON account_canonical_addons (sync_user, updated_at DESC, account_id);

-- HIGH PRIORITY: Autopilot worker queries (autopilot/engine.js:1000+) need updated_at ordering
CREATE INDEX IF NOT EXISTS idx_rules_updated_at ON autopilot_rules (updated_at DESC, id);

-- HIGH PRIORITY: Worker batch queries (autopilot/engine.js:1043) - composite for stats
CREATE INDEX IF NOT EXISTS idx_rule_stats_rule_id_updated ON autopilot_rule_stats (rule_id, updated_at DESC, last_check);

-- MEDIUM PRIORITY: Multi-column credential lookups (routes/hydra.js:73, routes/providers.js:15)
CREATE INDEX IF NOT EXISTS idx_creds_account_sync_type ON server_credentials (account_id, sync_user, credential_type, updated_at DESC);

-- MEDIUM PRIORITY: Failover history rule lookups (routes/autopilot.js:560, routes/sync.js:315)
CREATE INDEX IF NOT EXISTS idx_history_rule_ts ON failover_history (rule_id, timestamp DESC);

-- LOW PRIORITY: kv_store content_hash lookups (routes/sync.js:164) - hash-based dedup
CREATE INDEX IF NOT EXISTS idx_kv_content_hash ON kv_store (content_hash);
