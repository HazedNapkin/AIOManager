import path from 'path'
import db from '../db.js'
import { DATA_DIR, isReadOnlyReplica } from '../config.js'
import { domainLastRequestTime, globalHealthCache, proxyQueue, serverState } from '../state.js'

export async function initializeDatabase(fastify) {
    const dbPath = path.join(DATA_DIR, 'aio.db')
    if (db.type === 'sqlite') {
        fastify.log.info({ category: 'Database' }, `Initializing SQLite at: ${dbPath}`)
        process.env.SQLITE_DB_PATH = dbPath
    } else {
        fastify.log.info({ category: 'Database' }, 'Initializing PostgreSQL...')
    }
    await db.init()

    if (db.type === 'sqlite') {
        await db.pragma('journal_mode = WAL')
        await db.pragma('synchronous = NORMAL')
        await db.pragma('temp_store = MEMORY')
        await db.pragma('cache_size = -32000')
        await db.pragma('auto_vacuum = INCREMENTAL')
        await db.pragma('busy_timeout = 5000')

        // Schedule VACUUM weekly instead of on every startup (prevents blocking request handling)
        const VACUUM_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000
        const scheduleVacuum = () => {
            setTimeout(async () => {
                try {
                    fastify.log.info({ category: 'Database' }, 'Running scheduled weekly VACUUM...')
                    await db.exec('VACUUM')
                    fastify.log.info({ category: 'Database' }, 'VACUUM complete.')
                } catch (e) {
                    fastify.log.warn({ category: 'Database' }, `VACUUM failed: ${e.message}`)
                }
                scheduleVacuum()
            }, VACUUM_INTERVAL_MS)
        }
        scheduleVacuum()
    }

    if (isReadOnlyReplica()) {
        fastify.log.info({ category: 'Database' }, 'READ_ONLY_REPLICA mode: skipping schema and migrations (follower DB is read-only).')
        return dbPath
    }

    const schema = `
      CREATE TABLE IF NOT EXISTS kv_store (
        key TEXT PRIMARY KEY,
        value TEXT,
        password TEXT,
        updated_at BIGINT,
        content_hash TEXT
      );

      CREATE TABLE IF NOT EXISTS autopilot_rules (
        id TEXT PRIMARY KEY,
        account_id TEXT,
        auth_key TEXT,
        priority_chain TEXT,
        addon_list TEXT,
        active_url TEXT,
        webhook_url TEXT,
        stabilization TEXT,
        is_active INTEGER DEFAULT 1,
        is_automatic INTEGER DEFAULT 1,
        last_check BIGINT,
        last_notification BIGINT,
        updated_at BIGINT,
        name TEXT,
        cooldown_ms INTEGER,
        message_template TEXT,
        owner_sync_user TEXT,
        platform TEXT DEFAULT 'stremio',
        connection_id TEXT,
        custom_check_urls TEXT DEFAULT NULL
      );


      CREATE TABLE IF NOT EXISTS failover_history (
        id TEXT PRIMARY KEY,
        timestamp BIGINT,
        type TEXT,
        rule_id TEXT,
        account_id TEXT,
        primary_name TEXT,
        backup_name TEXT,
        message TEXT,
        metadata TEXT,
        latency_ms INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_history_account_ts ON failover_history (account_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_rules_account ON autopilot_rules (account_id);
      CREATE INDEX IF NOT EXISTS idx_rules_active_check ON autopilot_rules (is_active, last_check, id);
      CREATE INDEX IF NOT EXISTS idx_rules_active_id ON autopilot_rules (is_active, id);
      CREATE INDEX IF NOT EXISTS idx_rules_worker_scan ON autopilot_rules (is_active, is_automatic, id);

      CREATE TABLE IF NOT EXISTS autopilot_rule_stats (
        rule_id TEXT PRIMARY KEY,
        stabilization TEXT,
        last_check BIGINT,
        last_notification BIGINT,
        updated_at BIGINT
      );

      CREATE INDEX IF NOT EXISTS idx_rule_stats_last_check ON autopilot_rule_stats (last_check);
    `

    await db.exec(schema)

    // New tables for v2.0 activity engine - created separately with migration guards
    // so a stale intermediate table from dev builds doesn't crash the entire exec()
    async function ensureTable(tableName, createDdl, indexDdls, requiredColumns, addColumnDdls, pkColumns = []) {
        try {
            let tableExists = false
            let missingColumns = []

            const columnsToCheck = addColumnDdls
                ? [...new Set([...requiredColumns, ...Object.keys(addColumnDdls)])]
                : requiredColumns

            if (db.type === 'sqlite') {
                const cols = await db.query(`PRAGMA table_info(${tableName})`)
                tableExists = cols.length > 0
                if (tableExists) {
                    const colNames = new Set(cols.map(c => c.name))
                    for (const rc of columnsToCheck) {
                        if (!colNames.has(rc)) missingColumns.push(rc)
                    }
                }
            } else {
                const rows = await db.query(
                    `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public'`,
                    [tableName]
                )
                tableExists = rows.length > 0
                if (tableExists) {
                    const colNames = new Set(rows.map(r => r.column_name))
                    for (const rc of columnsToCheck) {
                        if (!colNames.has(rc)) missingColumns.push(rc)
                    }
                }
            }

            if (tableExists && missingColumns.length > 0) {
                const missingPks = missingColumns.filter(c => pkColumns.includes(c))
                if (missingPks.length > 0) {
                    fastify.log.warn({ category: 'Database' }, `${tableName} missing primary-key columns [${missingPks.join(', ')}]. Dropping and recreating (stale schema, no recoverable data).`)
                    await db.run(`DROP TABLE IF EXISTS ${tableName}`)
                    tableExists = false
                    missingColumns = []
                }
            }

            if (tableExists && missingColumns.length > 0 && addColumnDdls) {
                const stillMissing = []
                for (const col of missingColumns) {
                    const ddl = addColumnDdls[col]
                    if (ddl) {
                        try {
                            await db.run(ddl)
                            fastify.log.info({ category: 'Database' }, `Migrated: Added ${col} column to ${tableName}`)
                        } catch (alterErr) {
                            fastify.log.warn({ category: 'Database' }, `ALTER TABLE ${tableName} ADD ${col} failed: ${alterErr.message}`)
                            stillMissing.push(col)
                        }
                    } else {
                        stillMissing.push(col)
                    }
                }
                if (stillMissing.length > 0) {
                    fastify.log.warn({ category: 'Database' }, `${tableName} still missing columns after migration: [${stillMissing.join(', ')}]. Runtime errors may occur.`)
                }
            } else if (tableExists && missingColumns.length > 0 && !addColumnDdls) {
                fastify.log.warn({ category: 'Database' }, `${tableName} missing columns [${missingColumns.join(', ')}] but no migration DDL provided. Skipping.`)
            }

            if (!tableExists) {
                await db.exec(createDdl)
            }

            if (db.type !== 'sqlite' && addColumnDdls) {
                for (const ddl of Object.values(addColumnDdls)) {
                    try {
                        await db.run(ddl.replace(/\bADD COLUMN\b/i, 'ADD COLUMN IF NOT EXISTS'))
                    } catch (e) {
                        fastify.log.warn({ category: 'Database' }, `${tableName} idempotent column ensure failed: ${e.message}`)
                    }
                }
            }

            for (const idx of indexDdls) {
                try {
                    await db.run(idx)
                } catch (e) {
                    fastify.log.warn({ category: 'Database' }, `${tableName} index setup failed: ${e.message}`)
                }
            }
        } catch (e) {
            fastify.log.warn({ category: 'Database' }, `${tableName} setup warning: ${e.message}`)
        }
    }

    await ensureTable('activity_events', `
      CREATE TABLE IF NOT EXISTS activity_events (
        id TEXT PRIMARY KEY,
        sync_user TEXT NOT NULL,
        account_id TEXT NOT NULL,
        account_name TEXT,
        item_id TEXT NOT NULL,
        unique_item_id TEXT,
        item_name TEXT,
        item_type TEXT,
        poster TEXT,
        season INTEGER,
        episode INTEGER,
        video_id TEXT,
        event_type TEXT NOT NULL,
        event_ts BIGINT NOT NULL,
        duration BIGINT,
        progress REAL,
        watched INTEGER,
        times_watched INTEGER,
        is_in_progress INTEGER,
        overall_time_watched BIGINT,
        metadata TEXT,
        source TEXT NOT NULL DEFAULT 'stremio'
      );
    `, [
        `CREATE INDEX IF NOT EXISTS idx_activity_events_user_ts ON activity_events (sync_user, event_ts DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_activity_events_account_ts ON activity_events (account_id, event_ts DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_activity_events_type ON activity_events (sync_user, event_type, event_ts DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_activity_events_user_account_ts ON activity_events (sync_user, account_id, event_ts DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_activity_events_user_account_type_ts ON activity_events (sync_user, account_id, event_type, event_ts DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_activity_events_source ON activity_events (sync_user, source, event_ts DESC)`,
    ], ['id', 'sync_user', 'account_id', 'item_id', 'event_type', 'event_ts'], {
        sync_user: 'ALTER TABLE activity_events ADD COLUMN sync_user TEXT NOT NULL DEFAULT \'\'',
        account_id: 'ALTER TABLE activity_events ADD COLUMN account_id TEXT NOT NULL DEFAULT \'\'',
        item_id: 'ALTER TABLE activity_events ADD COLUMN item_id TEXT NOT NULL DEFAULT \'\'',
        event_type: 'ALTER TABLE activity_events ADD COLUMN event_type TEXT NOT NULL DEFAULT \'\'',
        event_ts: 'ALTER TABLE activity_events ADD COLUMN event_ts BIGINT NOT NULL DEFAULT 0',
        account_name: 'ALTER TABLE activity_events ADD COLUMN account_name TEXT',
        unique_item_id: 'ALTER TABLE activity_events ADD COLUMN unique_item_id TEXT',
        item_name: 'ALTER TABLE activity_events ADD COLUMN item_name TEXT',
        item_type: 'ALTER TABLE activity_events ADD COLUMN item_type TEXT',
        poster: 'ALTER TABLE activity_events ADD COLUMN poster TEXT',
        season: 'ALTER TABLE activity_events ADD COLUMN season INTEGER',
        episode: 'ALTER TABLE activity_events ADD COLUMN episode INTEGER',
        video_id: 'ALTER TABLE activity_events ADD COLUMN video_id TEXT',
        duration: 'ALTER TABLE activity_events ADD COLUMN duration BIGINT',
        progress: 'ALTER TABLE activity_events ADD COLUMN progress REAL',
        watched: 'ALTER TABLE activity_events ADD COLUMN watched INTEGER',
        times_watched: 'ALTER TABLE activity_events ADD COLUMN times_watched INTEGER',
        is_in_progress: 'ALTER TABLE activity_events ADD COLUMN is_in_progress INTEGER',
        overall_time_watched: 'ALTER TABLE activity_events ADD COLUMN overall_time_watched BIGINT',
        metadata: 'ALTER TABLE activity_events ADD COLUMN metadata TEXT',
        source: 'ALTER TABLE activity_events ADD COLUMN source TEXT NOT NULL DEFAULT \'stremio\'',
    }, ['id'])

    await ensureTable('activity_snapshots', `
      CREATE TABLE IF NOT EXISTS activity_snapshots (
        sync_user TEXT NOT NULL,
        account_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        unique_item_id TEXT,
        item_name TEXT,
        item_type TEXT,
        poster TEXT,
        season INTEGER,
        episode INTEGER,
        video_id TEXT,
        duration BIGINT,
        progress REAL,
        watched INTEGER,
        times_watched INTEGER,
        is_in_progress INTEGER,
        overall_time_watched BIGINT,
        mtime BIGINT,
        source TEXT NOT NULL DEFAULT 'stremio',
        PRIMARY KEY (sync_user, account_id, item_id)
      );
    `, [], ['sync_user', 'account_id', 'item_id', 'mtime'], {
        unique_item_id: 'ALTER TABLE activity_snapshots ADD COLUMN unique_item_id TEXT',
        item_name: 'ALTER TABLE activity_snapshots ADD COLUMN item_name TEXT',
        item_type: 'ALTER TABLE activity_snapshots ADD COLUMN item_type TEXT',
        poster: 'ALTER TABLE activity_snapshots ADD COLUMN poster TEXT',
        season: 'ALTER TABLE activity_snapshots ADD COLUMN season INTEGER',
        episode: 'ALTER TABLE activity_snapshots ADD COLUMN episode INTEGER',
        video_id: 'ALTER TABLE activity_snapshots ADD COLUMN video_id TEXT',
        duration: 'ALTER TABLE activity_snapshots ADD COLUMN duration BIGINT',
        progress: 'ALTER TABLE activity_snapshots ADD COLUMN progress REAL',
        watched: 'ALTER TABLE activity_snapshots ADD COLUMN watched INTEGER',
        times_watched: 'ALTER TABLE activity_snapshots ADD COLUMN times_watched INTEGER',
        is_in_progress: 'ALTER TABLE activity_snapshots ADD COLUMN is_in_progress INTEGER',
        overall_time_watched: 'ALTER TABLE activity_snapshots ADD COLUMN overall_time_watched BIGINT',
        mtime: 'ALTER TABLE activity_snapshots ADD COLUMN mtime BIGINT',
        source: 'ALTER TABLE activity_snapshots ADD COLUMN source TEXT NOT NULL DEFAULT \'stremio\'',
    }, ['sync_user', 'account_id', 'item_id'])

    await ensureTable('server_credentials', `
      CREATE TABLE IF NOT EXISTS server_credentials (
        id TEXT PRIMARY KEY,
        sync_user TEXT NOT NULL,
        account_id TEXT NOT NULL,
        account_name TEXT,
        auth_key TEXT NOT NULL,
        updated_at BIGINT,
        connection_id TEXT,
        credential_type TEXT DEFAULT 'stremio'
      );
    `, [
        `CREATE INDEX IF NOT EXISTS idx_creds_sync_user ON server_credentials (sync_user)`,
        `CREATE INDEX IF NOT EXISTS idx_creds_account ON server_credentials (account_id)`,
        `CREATE INDEX IF NOT EXISTS idx_creds_type_updated ON server_credentials (credential_type, updated_at DESC, id ASC)`,
    ], ['id', 'sync_user', 'account_id', 'auth_key'], {
        sync_user: 'ALTER TABLE server_credentials ADD COLUMN sync_user TEXT NOT NULL DEFAULT \'\'',
        account_id: 'ALTER TABLE server_credentials ADD COLUMN account_id TEXT NOT NULL DEFAULT \'\'',
        auth_key: 'ALTER TABLE server_credentials ADD COLUMN auth_key TEXT NOT NULL DEFAULT \'\'',
        account_name: 'ALTER TABLE server_credentials ADD COLUMN account_name TEXT',
        updated_at: 'ALTER TABLE server_credentials ADD COLUMN updated_at BIGINT',
        connection_id: 'ALTER TABLE server_credentials ADD COLUMN connection_id TEXT',
        credential_type: 'ALTER TABLE server_credentials ADD COLUMN credential_type TEXT DEFAULT \'stremio\'',
    }, ['id'])

    await ensureTable('account_api_keys', `
      CREATE TABLE IF NOT EXISTS account_api_keys (
        account_id TEXT NOT NULL,
        sync_user TEXT NOT NULL,
        api_key_hash TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        last_used_at BIGINT,
        UNIQUE (sync_user, api_key_hash)
      );
    `, [
        `CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON account_api_keys (api_key_hash)`,
        `CREATE INDEX IF NOT EXISTS idx_api_keys_sync_user ON account_api_keys (sync_user)`,
    ], ['account_id', 'sync_user', 'api_key_hash', 'created_at'], {
        api_key_hash: 'ALTER TABLE account_api_keys ADD COLUMN api_key_hash TEXT NOT NULL DEFAULT \'\'',
        created_at: 'ALTER TABLE account_api_keys ADD COLUMN created_at BIGINT NOT NULL DEFAULT 0',
        last_used_at: 'ALTER TABLE account_api_keys ADD COLUMN last_used_at BIGINT',
    }, ['account_id', 'sync_user'])

    await ensureTable('account_canonical_addons', `
      CREATE TABLE IF NOT EXISTS account_canonical_addons (
        account_id TEXT PRIMARY KEY,
        sync_user TEXT NOT NULL,
        addon_list TEXT,
        updated_at BIGINT
      );
    `, [
        `CREATE INDEX IF NOT EXISTS idx_canonical_addons_sync_user ON account_canonical_addons (sync_user)`,
    ], ['account_id', 'sync_user'], {
        sync_user: 'ALTER TABLE account_canonical_addons ADD COLUMN sync_user TEXT NOT NULL DEFAULT \'\'',
        addon_list: 'ALTER TABLE account_canonical_addons ADD COLUMN addon_list TEXT',
        updated_at: 'ALTER TABLE account_canonical_addons ADD COLUMN updated_at BIGINT',
    }, ['account_id'])

    // Pull-mode Hydra apps (backendless, e.g. Fusion) register on connect so they surface as
    // connection cards with a last-seen time. AIOManager never pushes to them; they pull.
    await ensureTable('hydra_subscribers', `
      CREATE TABLE IF NOT EXISTS hydra_subscribers (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        sync_user TEXT NOT NULL,
        name TEXT,
        logo TEXT,
        created_at BIGINT NOT NULL,
        last_seen_at BIGINT
      );
    `, [
        `CREATE INDEX IF NOT EXISTS idx_hydra_subs_account ON hydra_subscribers (account_id, sync_user)`,
    ], ['id', 'account_id', 'sync_user', 'created_at'], {
        name: 'ALTER TABLE hydra_subscribers ADD COLUMN name TEXT',
        logo: 'ALTER TABLE hydra_subscribers ADD COLUMN logo TEXT',
        last_seen_at: 'ALTER TABLE hydra_subscribers ADD COLUMN last_seen_at BIGINT',
    }, ['id'])

    try {
        if (db.type === 'postgres') {
            try { await db.run(`ALTER TABLE autopilot_rules ADD COLUMN IF NOT EXISTS is_active INTEGER DEFAULT 1`) } catch (e) { if (!String(e?.message).includes('already exists')) fastify.log.warn({ category: 'Database' }, `PG migration is_active: ${e?.message}`) }
            try { await db.run(`ALTER TABLE autopilot_rules ADD COLUMN IF NOT EXISTS addon_list TEXT`) } catch (e) { if (!String(e?.message).includes('already exists')) fastify.log.warn({ category: 'Database' }, `PG migration addon_list: ${e?.message}`) }
            try { await db.run(`ALTER TABLE autopilot_rules ADD COLUMN IF NOT EXISTS active_url TEXT`) } catch (e) { if (!String(e?.message).includes('already exists')) fastify.log.warn({ category: 'Database' }, `PG migration active_url: ${e?.message}`) }
            try { await db.run(`ALTER TABLE autopilot_rules ADD COLUMN IF NOT EXISTS webhook_url TEXT`) } catch (e) { if (!String(e?.message).includes('already exists')) fastify.log.warn({ category: 'Database' }, `PG migration webhook_url: ${e?.message}`) }
            try { await db.run(`ALTER TABLE autopilot_rules ADD COLUMN IF NOT EXISTS is_automatic INTEGER DEFAULT 1`) } catch (e) { if (!String(e?.message).includes('already exists')) fastify.log.warn({ category: 'Database' }, `PG migration is_automatic: ${e?.message}`) }
            try { await db.run(`ALTER TABLE autopilot_rules ADD COLUMN IF NOT EXISTS stabilization TEXT`) } catch (e) { if (!String(e?.message).includes('already exists')) fastify.log.warn({ category: 'Database' }, `PG migration stabilization: ${e?.message}`) }
            try { await db.run(`ALTER TABLE autopilot_rules ADD COLUMN IF NOT EXISTS last_notification BIGINT`) } catch (e) { if (!String(e?.message).includes('already exists')) fastify.log.warn({ category: 'Database' }, `PG migration last_notification: ${e?.message}`) }
            try { await db.run(`ALTER TABLE autopilot_rules ADD COLUMN IF NOT EXISTS name TEXT`) } catch (e) { if (!String(e?.message).includes('already exists')) fastify.log.warn({ category: 'Database' }, `PG migration name: ${e?.message}`) }
            try { await db.run(`ALTER TABLE autopilot_rules ADD COLUMN IF NOT EXISTS cooldown_ms INTEGER`) } catch (e) { if (!String(e?.message).includes('already exists')) fastify.log.warn({ category: 'Database' }, `PG migration cooldown_ms: ${e?.message}`) }
            try { await db.run(`ALTER TABLE autopilot_rules ADD COLUMN IF NOT EXISTS message_template TEXT`) } catch (e) { if (!String(e?.message).includes('already exists')) fastify.log.warn({ category: 'Database' }, `PG migration message_template: ${e?.message}`) }
            try { await db.run(`ALTER TABLE autopilot_rules ADD COLUMN IF NOT EXISTS owner_sync_user TEXT`) } catch (e) { if (!String(e?.message).includes('already exists')) fastify.log.warn({ category: 'Database' }, `PG migration owner_sync_user: ${e?.message}`) }
            try { await db.run(`ALTER TABLE autopilot_rules ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'stremio'`) } catch (e) { if (!String(e?.message).includes('already exists')) fastify.log.warn({ category: 'Database' }, `PG migration platform: ${e?.message}`) }
            try { await db.run(`ALTER TABLE autopilot_rules ADD COLUMN IF NOT EXISTS connection_id TEXT`) } catch (e) { if (!String(e?.message).includes('already exists')) fastify.log.warn({ category: 'Database' }, `PG migration connection_id: ${e?.message}`) }
            try { await db.run(`ALTER TABLE autopilot_rules ADD COLUMN IF NOT EXISTS custom_check_urls TEXT DEFAULT NULL`) } catch (e) { if (!String(e?.message).includes('already exists')) fastify.log.warn({ category: 'Database' }, `PG migration custom_check_urls: ${e?.message}`) }

            try {
                const platformBackfill = await db.run(`UPDATE autopilot_rules SET platform = 'stremio' WHERE platform IS NULL`)
                if (platformBackfill?.changes > 0) {
                    fastify.log.info({ category: 'Database' }, `Autopilot Rules: backfilled platform='stremio' for ${platformBackfill.changes} rows.`)
                }
            } catch (e) { fastify.log.warn({ category: 'Database' }, `PG migration platform backfill: ${e.message}`) }

            // Migration: Ensure columns are TEXT/VARCHAR for encrypted strings, not JSONB
            // We use try/catch to avoid aborting if the types are already correct
            // Using explicit casting (USING column::TEXT) ensures stability if columns were manually tweaked
            try { await db.run(`ALTER TABLE autopilot_rules ALTER COLUMN priority_chain TYPE TEXT USING priority_chain::TEXT`) } catch (e) { fastify.log.warn({ category: 'Database' }, `Migration step failed: ${e.message}`) }
            try { await db.run(`ALTER TABLE autopilot_rules ALTER COLUMN addon_list TYPE TEXT USING addon_list::TEXT`) } catch (e) { fastify.log.warn({ category: 'Database' }, `Migration step failed: ${e.message}`) }
            try { await db.run(`ALTER TABLE autopilot_rules ALTER COLUMN stabilization TYPE TEXT USING stabilization::TEXT`) } catch (e) { fastify.log.warn({ category: 'Database' }, `Migration step failed: ${e.message}`) }

            try { await db.run(`ALTER TABLE kv_store ADD COLUMN IF NOT EXISTS content_hash TEXT`) } catch (e) { fastify.log.warn({ category: 'Database' }, `Migration step failed: ${e.message}`) }

            try { await db.run(`CREATE INDEX IF NOT EXISTS idx_rules_owner ON autopilot_rules (owner_sync_user)`) } catch (e) { fastify.log.warn({ category: 'Database' }, `Migration step failed: ${e.message}`) }
            try { await db.run(`CREATE INDEX IF NOT EXISTS idx_rules_active_id ON autopilot_rules (is_active, id)`) } catch (e) { fastify.log.warn({ category: 'Database' }, `Migration step failed: ${e.message}`) }
            try { await db.run(`CREATE INDEX IF NOT EXISTS idx_rules_worker_scan ON autopilot_rules (is_active, is_automatic, id)`) } catch (e) { fastify.log.warn({ category: 'Database' }, `Migration step failed: ${e.message}`) }
            try { await db.run(`CREATE INDEX IF NOT EXISTS idx_rules_platform ON autopilot_rules (platform)`) } catch (e) { fastify.log.warn({ category: 'Database' }, `Migration step failed: ${e.message}`) }
            try { await db.run(`CREATE INDEX IF NOT EXISTS idx_rules_connection ON autopilot_rules (connection_id)`) } catch (e) { fastify.log.warn({ category: 'Database' }, `Migration step failed: ${e.message}`) }

            try { await db.run(`ALTER TABLE failover_history ADD COLUMN IF NOT EXISTS latency_ms INTEGER`) } catch (e) { fastify.log.warn({ category: 'Database' }, `Migration step failed: ${e.message}`) }

            try { await db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_user_hash ON account_api_keys (sync_user, api_key_hash)`) } catch (e) { fastify.log.error({ category: 'Database' }, `Failed to create idx_api_keys_user_hash: ${e.message}. Duplicate rows may exist.`) }

            fastify.log.info({ category: 'Database' }, 'Postgres Migration: Verified columns and types for encryption support.')
        } else {
            // SQLite doesn't have IF NOT EXISTS for columns, so we check first
            const tableInfo = await db.query(`PRAGMA table_info(autopilot_rules)`)
            const hasAddonList = tableInfo.some(col => col.name === 'addon_list')
            if (!hasAddonList) {
                await db.run(`ALTER TABLE autopilot_rules ADD COLUMN addon_list TEXT`)
                fastify.log.info({ category: 'Database' }, 'Migrated: Added addon_list column to autopilot_rules')
            }
            const hasIsAutomatic = tableInfo.some(col => col.name === 'is_automatic')
            if (!hasIsAutomatic) {
                await db.run(`ALTER TABLE autopilot_rules ADD COLUMN is_automatic INTEGER DEFAULT 1`)
                fastify.log.info({ category: 'Database' }, 'Migrated: Added is_automatic column to autopilot_rules')
            }
            const hasName = tableInfo.some(col => col.name === 'name')
            if (!hasName) {
                await db.run(`ALTER TABLE autopilot_rules ADD COLUMN name TEXT`)
                fastify.log.info({ category: 'Database' }, 'Migrated: Added name column to autopilot_rules')
            }
            const hasCooldownMs = tableInfo.some(col => col.name === 'cooldown_ms')
            if (!hasCooldownMs) {
                await db.run(`ALTER TABLE autopilot_rules ADD COLUMN cooldown_ms INTEGER`)
                fastify.log.info({ category: 'Database' }, 'Migrated: Added cooldown_ms column to autopilot_rules')
            }
            const hasWebhookUrl = tableInfo.some(col => col.name === 'webhook_url')
            if (!hasWebhookUrl) {
                await db.run(`ALTER TABLE autopilot_rules ADD COLUMN webhook_url TEXT`)
                fastify.log.info({ category: 'Database' }, 'Migrated: Added webhook_url column to autopilot_rules')
            }
            const hasActiveUrl = tableInfo.some(col => col.name === 'active_url')
            if (!hasActiveUrl) {
                await db.run(`ALTER TABLE autopilot_rules ADD COLUMN active_url TEXT`)
                fastify.log.info({ category: 'Database' }, 'Migrated: Added active_url column to autopilot_rules')
            }
            const hasStabilization = tableInfo.some(col => col.name === 'stabilization')
            if (!hasStabilization) {
                await db.run(`ALTER TABLE autopilot_rules ADD COLUMN stabilization TEXT`)
                fastify.log.info({ category: 'Database' }, 'Migrated: Added stabilization column to autopilot_rules')
            }
            const hasLastNotification = tableInfo.some(col => col.name === 'last_notification')
            if (!hasLastNotification) {
                await db.run(`ALTER TABLE autopilot_rules ADD COLUMN last_notification BIGINT`)
                fastify.log.info({ category: 'Database' }, 'Migrated: Added last_notification column to autopilot_rules')
            }
            const hasIsActive = tableInfo.some(col => col.name === 'is_active')
            if (!hasIsActive) {
                await db.run(`ALTER TABLE autopilot_rules ADD COLUMN is_active INTEGER DEFAULT 1`)
                fastify.log.info({ category: 'Database' }, 'Migrated: Added is_active column to autopilot_rules')
            }
            const hasMessageTemplate = tableInfo.some(col => col.name === 'message_template')
            if (!hasMessageTemplate) {
                await db.run(`ALTER TABLE autopilot_rules ADD COLUMN message_template TEXT`)
                fastify.log.info({ category: 'Database' }, 'Migrated: Added message_template column to autopilot_rules')
            }
            const hasOwnerSyncUser = tableInfo.some(col => col.name === 'owner_sync_user')
            if (!hasOwnerSyncUser) {
                await db.run(`ALTER TABLE autopilot_rules ADD COLUMN owner_sync_user TEXT`)
                fastify.log.info({ category: 'Database' }, 'Migrated: Added owner_sync_user column to autopilot_rules')
            }
            const hasPlatform = tableInfo.some(col => col.name === 'platform')
            if (!hasPlatform) {
                await db.run(`ALTER TABLE autopilot_rules ADD COLUMN platform TEXT DEFAULT 'stremio'`)
                fastify.log.info({ category: 'Database' }, 'Migrated: Added platform column to autopilot_rules')
            }
            const hasConnectionId = tableInfo.some(col => col.name === 'connection_id')
            if (!hasConnectionId) {
                await db.run(`ALTER TABLE autopilot_rules ADD COLUMN connection_id TEXT`)
                fastify.log.info({ category: 'Database' }, 'Migrated: Added connection_id column to autopilot_rules')
            }
            const hasCustomCheckUrls = tableInfo.some(col => col.name === 'custom_check_urls')
            if (!hasCustomCheckUrls) {
                await db.run(`ALTER TABLE autopilot_rules ADD COLUMN custom_check_urls TEXT DEFAULT NULL`)
                fastify.log.info({ category: 'Database' }, 'Migrated: Added custom_check_urls column to autopilot_rules')
            }
            if (!hasPlatform) {
                try {
                    const platformBackfill = await db.run(`UPDATE autopilot_rules SET platform = 'stremio' WHERE platform IS NULL`)
                    if (platformBackfill?.changes > 0) {
                        fastify.log.info({ category: 'Database' }, `Autopilot Rules: backfilled platform='stremio' for ${platformBackfill.changes} rows.`)
                    }
                } catch (e) { fastify.log.warn({ category: 'Database' }, `SQLite migration platform backfill: ${e.message}`) }
            }
            const kvTableInfo = await db.query(`PRAGMA table_info(kv_store)`)
            const hasContentHash = kvTableInfo.some(col => col.name === 'content_hash')
            if (!hasContentHash) {
                await db.run(`ALTER TABLE kv_store ADD COLUMN content_hash TEXT`)
                fastify.log.info({ category: 'Database' }, 'Migrated: Added content_hash column to kv_store')
            }
            const fhTableInfo = await db.query(`PRAGMA table_info(failover_history)`)
            const hasLatencyMs = fhTableInfo.some(col => col.name === 'latency_ms')
            if (!hasLatencyMs) {
                await db.run(`ALTER TABLE failover_history ADD COLUMN latency_ms INTEGER`)
                fastify.log.info({ category: 'Database' }, 'Migrated: Added latency_ms column to failover_history')
            }
            try {
                await db.run(`CREATE INDEX IF NOT EXISTS idx_rules_active_id ON autopilot_rules (is_active, id)`)
            } catch (e) { fastify.log.warn({ category: 'Database' }, `Migration step failed: ${e.message}`) }
            try {
                await db.run(`CREATE INDEX IF NOT EXISTS idx_rules_worker_scan ON autopilot_rules (is_active, is_automatic, id)`)
            } catch (e) { fastify.log.warn({ category: 'Database' }, `Migration step failed: ${e.message}`) }
            try {
                await db.run(`CREATE INDEX IF NOT EXISTS idx_rules_owner ON autopilot_rules (owner_sync_user)`)
            } catch (e) { fastify.log.warn({ category: 'Database' }, `Migration step failed: ${e.message}`) }
            try {
                await db.run(`CREATE INDEX IF NOT EXISTS idx_rules_platform ON autopilot_rules (platform)`)
            } catch (e) { fastify.log.warn({ category: 'Database' }, `Migration step failed: ${e.message}`) }
            try {
                await db.run(`CREATE INDEX IF NOT EXISTS idx_rules_connection ON autopilot_rules (connection_id)`)
            } catch (e) { fastify.log.warn({ category: 'Database' }, `Migration step failed: ${e.message}`) }
            try {
                await db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_user_hash ON account_api_keys (sync_user, api_key_hash)`)
            } catch (e) { fastify.log.error({ category: 'Database' }, `Failed to create idx_api_keys_user_hash: ${e.message}. Duplicate rows may exist.`) }
        }

        // Backfill any rules that lack a stats row. Idempotent and cheap when fully populated.
        // SQLite needs INSERT OR IGNORE - INSERT-SELECT-ON-CONFLICT is parser-ambiguous against
        // SELECT 's JOIN ... ON clause; PostgreSQL takes the standard ON CONFLICT form.
        try {
            const beforeCount = await db.get(`SELECT COUNT(*) as c FROM autopilot_rule_stats`)
            if (db.type === 'postgres') {
                await db.run(`
                    INSERT INTO autopilot_rule_stats (rule_id, stabilization, last_check, last_notification, updated_at)
                    SELECT id, stabilization, last_check, last_notification, updated_at
                    FROM autopilot_rules
                    ON CONFLICT (rule_id) DO NOTHING
                `)
            } else {
                await db.run(`
                    INSERT OR IGNORE INTO autopilot_rule_stats (rule_id, stabilization, last_check, last_notification, updated_at)
                    SELECT id, stabilization, last_check, last_notification, updated_at
                    FROM autopilot_rules
                `)
            }
            const afterCount = await db.get(`SELECT COUNT(*) as c FROM autopilot_rule_stats`)
            const inserted = Number(afterCount?.c || 0) - Number(beforeCount?.c || 0)
            if (inserted > 0) {
                fastify.log.info({ category: 'Database' }, `Autopilot Rule Stats: seeded ${inserted} missing rows.`)
            }
        } catch (statsBackfillErr) {
            fastify.log.warn({ category: 'Database' }, `Autopilot Rule Stats backfill warning: ${statsBackfillErr.message}`)
        }

        try {
            const credsCount = await db.get(`SELECT COUNT(*) as c FROM server_credentials`)
            if (Number(credsCount?.c || 0) === 0) {
                const rules = await db.query(
                    `SELECT DISTINCT r.account_id, r.auth_key, r.owner_sync_user FROM autopilot_rules r WHERE r.auth_key IS NOT NULL AND r.owner_sync_user IS NOT NULL`
                )
                let credsSeeded = 0
                for (const rule of rules) {
                    try {
                        const credId = `${rule.owner_sync_user}:${rule.account_id}`
                        if (db.type === 'postgres') {
                            await db.run(
                                `INSERT INTO server_credentials (id, sync_user, account_id, auth_key, updated_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO UPDATE SET auth_key = EXCLUDED.auth_key, updated_at = EXCLUDED.updated_at`,
                                [credId, rule.owner_sync_user, rule.account_id, rule.auth_key, Date.now()]
                            )
                        } else {
                            await db.run(
                                `INSERT OR REPLACE INTO server_credentials (id, sync_user, account_id, auth_key, updated_at) VALUES ($1, $2, $3, $4, $5)`,
                                [credId, rule.owner_sync_user, rule.account_id, rule.auth_key, Date.now()]
                            )
                        }
                        credsSeeded++
                    } catch (e) {
                        fastify.log.warn({ category: 'Database' }, `Credential backfill failed for ${rule.account_id}: ${e.message}`)
                    }
                }
                if (credsSeeded > 0) {
                    fastify.log.info({ category: 'Database' }, `Server Credentials: backfilled ${credsSeeded} accounts from autopilot rules.`)
                }
            }
        } catch (credsBackfillErr) {
            fastify.log.warn({ category: 'Database' }, `Server Credentials backfill warning: ${credsBackfillErr.message}`)
        }

        try {
            const backfilled = await db.run(
                `UPDATE server_credentials SET credential_type = 'stremio' WHERE credential_type IS NULL`
            )
            if (backfilled?.changes > 0) {
                fastify.log.info({ category: 'Database' }, `Server Credentials: backfilled credential_type for ${backfilled.changes} rows.`)
            }
            try {
                await db.run(`CREATE INDEX IF NOT EXISTS idx_creds_connection ON server_credentials (connection_id)`)
                await db.run(`CREATE INDEX IF NOT EXISTS idx_creds_type_updated ON server_credentials (credential_type, updated_at DESC, id ASC)`)
            } catch (e) { fastify.log.warn({ category: 'Database' }, `Migration step failed: ${e.message}`) }
        } catch (e) { fastify.log.warn({ category: 'Database' }, `Migration step failed: ${e.message}`) }
    } catch (migrationErr) {
        fastify.log.warn({ category: 'Database' }, `Migration warning: ${migrationErr.message}`)
    }

    try {
        const MIGRATION_KEY = 'migration:activity_season_clamp_v1'
        const done = await db.get(`SELECT key FROM kv_store WHERE key = $1`, [MIGRATION_KEY])
        if (!done) {
            const e1 = await db.run(`UPDATE activity_events SET season = NULL WHERE season > 100 OR season < 0`)
            const e2 = await db.run(`UPDATE activity_snapshots SET season = NULL WHERE season > 100 OR season < 0`)
            await db.run(
                db.type === 'postgres'
                    ? `INSERT INTO kv_store (key, value, updated_at) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING`
                    : `INSERT OR IGNORE INTO kv_store (key, value, updated_at) VALUES ($1, $2, $3)`,
                [MIGRATION_KEY, '1', Date.now()]
            )
            const cleaned = Number(e1?.changes || 0) + Number(e2?.changes || 0)
            if (cleaned > 0) {
                fastify.log.info({ category: 'Database' }, `Activity cleanup: nulled ${cleaned} implausible season values (anime id pollution).`)
            }
        }
    } catch (e) {
        fastify.log.warn({ category: 'Database' }, `Activity season cleanup failed: ${e.message}`)
    }

    try {
        if (db.type === 'sqlite') {
            await db.pragma('wal_checkpoint(TRUNCATE)')
            fastify.log.info({ category: 'Database' }, 'Startup: WAL checkpoint completed - cleared stale locks.')
        } else if (db.type === 'postgres') {
            await db.run(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND state = 'idle in transaction' AND pid <> pg_backend_pid() AND usename = current_user`).catch((e) => { fastify.log.warn({ category: 'Database' }, `pg_terminate_backend cleanup failed: ${e.message}`) })
            fastify.log.info({ category: 'Database' }, 'Startup: Cleared stale PostgreSQL transactions.')
        }
        serverState.isWorkerRunning = false
        proxyQueue.length = 0
        domainLastRequestTime.clear()
        globalHealthCache.clear()
        fastify.log.info({ category: 'Server' }, 'Startup cleanup: Reset in-memory state from previous session.')
    } catch (cleanupErr) {
        fastify.log.warn({ category: 'Database' }, `Startup cleanup warning: ${cleanupErr.message}`)
    }
    return dbPath
}
