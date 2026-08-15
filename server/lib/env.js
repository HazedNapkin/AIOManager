// Single source of truth for AIOManager server environment configuration.
//
// Every environment variable the server reads is declared here with a zod
// schema (type, default, range) and a human-readable description. All values
// are validated once at boot: wrong types and out-of-range values kill the
// process with a message naming the variable. Unrecognized variables that look
// like typos of known ones produce a one-line warning — never a hard failure,
// because users legitimately carry leftover variables in their environments.
//
// Numeric fields with legacy Math.max clamping behavior (below-min values are
// clamped to min with a console.warn, not fatal) preserve the old behavior:
// IMAGE_PROXY_*, IMAGE_CACHE_*, AIOSTREAMS_USER_API_THROTTLE_MS, and all
// ACTIVITY_*/AUTOPILOT_* vars that were previously clamped in their engine
// files. Values below min clamp to min; values above max remain fatal.
//
// The .env.example at the repo root is generated from this file:
//   npm --prefix server run gen:env
//
// Emergency escape hatch (NOT recommended): SKIP_ENV_VALIDATION=1 boots with
// raw, unvalidated values.

import path from 'path'
import { fileURLToPath } from 'url'
import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const DEFAULT_DATA_DIR = path.join(__dirname, '..', 'data')

const TRUTHY = ['1', 'true', 'yes', 'on']
const BOOL_LITERALS = [...TRUTHY, '0', 'false', 'no', 'off']

// ---------------------------------------------------------------------------
// Field builders: each returns { schema, meta } so .env.example can be
// generated from the same definition that validates at runtime.
// ---------------------------------------------------------------------------

function int(def, { min, max, clampBelowMin } = {}, desc) {
    let schema = z
        .number({ error: 'must be a number' })
        .int({ error: 'must be a whole number' })
    if (min !== undefined && !clampBelowMin) schema = schema.min(min, { error: `must be >= ${min}` })
    if (max !== undefined) schema = schema.max(max, { error: `must be <= ${max}` })

    let preprocessor = (raw) => (raw == null || raw === '' ? def : Number(raw))
    
    // Add clamping preprocessor for legacy Math.max behavior
    if (clampBelowMin && min !== undefined) {
        preprocessor = (raw) => {
            const value = (raw == null || raw === '' ? def : Number(raw))
            if (value < min) {
                console.warn(`Environment variable value ${value} is below minimum ${min}, clamping to ${min}`)
                return min
            }
            return value
        }
    }

    return {
        schema: z
            .preprocess(preprocessor, schema)
            .describe(desc),
        meta: { type: 'integer', default: def, ...(min !== undefined && { min }), ...(max !== undefined && { max }), desc, ...(clampBelowMin && { clampBelowMin: true }) },
    }
}

function bool(def, desc) {
    return {
        schema: z
            .preprocess(
                (raw) => (raw == null || raw === '' ? String(def) : String(raw)).toLowerCase(),
                z.enum(BOOL_LITERALS, { error: `must be a boolean (${BOOL_LITERALS.join('/')})` }).transform((v) => TRUTHY.includes(v))
            )
            .describe(desc),
        meta: { type: 'boolean', default: def, desc },
    }
}

function enumString(def, allowed, desc) {
    return {
        schema: z
            .preprocess((raw) => (raw == null || raw === '' ? def : raw), z.enum(allowed, { error: `must be one of: ${allowed.join(', ')}` }))
            .describe(desc),
        meta: { type: 'string', default: def, allowed, desc },
    }
}

function string(def, desc, extraMeta = {}) {
    return {
        schema: z
            .preprocess((raw) => (raw == null || raw === '' ? def : raw), z.string({ error: 'must be a string' }))
            .describe(desc),
        meta: { type: 'string', default: def, desc, ...extraMeta },
    }
}

function optionalString(desc) {
    return {
        schema: z
            .preprocess((raw) => (raw == null || raw === '' ? undefined : raw), z.string().optional())
            .describe(desc),
        meta: { type: 'string', default: null, desc },
    }
}

function stringList(def, desc, extraMeta = {}) {
    return {
        schema: z
            .preprocess(
                (raw) => (raw == null || raw === '' ? def : String(raw).split(',').map((s) => s.trim()).filter(Boolean)),
                z.array(z.string()).min(1, { error: 'must contain at least one non-empty, comma-separated entry' })
            )
            .describe(desc),
        meta: { type: 'comma-separated list', default: def, desc, ...extraMeta },
    }
}

// ---------------------------------------------------------------------------
// The schema. Defaults below MUST match the previously hardcoded fallbacks
// exactly (PORT 1610, DB_TYPE sqlite, ...) — this module validates, it does
// not change behavior.
// ---------------------------------------------------------------------------

const FIELDS = {
    // --- Essential ---
    PORT: int(1610, { min: 1, max: 65535 },
        'Port the server listens on (bound to 0.0.0.0). Local development tip: use 16100 to avoid clashing with a Docker container mapped to host port 1610.'),
    NODE_ENV: string('production',
        'Runtime mode. Only "development" changes behavior (verbose/dev helpers in a few modules); all other values including "production", "staging", "prod", etc. are treated identically.'),
    DATA_DIR: string(DEFAULT_DATA_DIR,
        'Directory for the SQLite database, the generated server_secret.key and traces. In Docker this must match the volume mount path (e.g. /app/data). Default: <server>/data',
        { defaultLabel: '<server>/data (Docker: /app/data)' }),
    MAX_SYNC_PAYLOAD_SIZE: int(104857600, { min: 1 },
        'Maximum size in bytes of the encrypted sync-state blob accepted by the sync API. Default: 100 MB (104857600).'),

    // --- Database ---
    DB_TYPE: enumString('sqlite', ['sqlite', 'postgres'],
        'Database engine: sqlite (zero-config, file-based) or postgres (recommended for scale / multi-tenant).'),
    DATABASE_URL: optionalString(
        'PostgreSQL connection string, e.g. postgres://user:password@host:5432/dbname. REQUIRED when DB_TYPE=postgres, ignored for sqlite. Leave unset for SQLite.'),
    DB_SSL_REJECT_UNAUTHORIZED: bool(false,
        'Verify the PostgreSQL server TLS certificate. Disabled by default because many providers use self-signed certificates; enable only with a trusted, pinned certificate path.'),
    DB_POOL_SIZE: int(20, { min: 1 },
        'Maximum number of PostgreSQL pool connections (ignored when DB_TYPE=sqlite).'),
    DB_CONNECTION_TIMEOUT: int(10000, { min: 1 },
        'Milliseconds to wait for a pool connection before timing out (PostgreSQL only).'),
    DB_MAX_RETRIES: int(5, { min: 1 },
        'Number of PostgreSQL connection attempts on startup with exponential backoff.'),
    READ_ONLY_REPLICA: bool(false,
        'Run as a read-only standby against a replicated PostgreSQL database: skips schema/migrations and never starts the autopilot or activity workers, so the standby makes no background writes against your accounts. GET /api/health stays 200 while GET /api/ready returns 503 — point write-routing probes at /api/ready. Replicated rows are encrypted with the primary key: set ENCRYPTION_KEY (or copy server_secret.key) to the SAME value as the primary, otherwise the standby serves empty configs/addons. To take over: promote the replica (pg_promote) and restart with this unset.'),

    // --- Security ---
    ENCRYPTION_KEY: optionalString(
        'Encrypts sensitive data at rest (autopilot rules, Stremio auth keys, connection credentials). Zero-config: when empty, a secure random key is generated on first boot and saved to DATA_DIR/server_secret.key. Setting a value later keeps the old file key as a decrypt fallback so existing data stays readable.'),
    CORS_ORIGINS: stringList(['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173'],
        'Comma-separated allow-list of browser origins for the API, e.g. https://app.example.com,https://stremio.example.com. Empty = localhost-only development defaults.',
        { defaultLabel: 'localhost development origins (3000/5173/4173)' }),
    SSRF_ALLOW_PRIVATE: bool(false,
        'Allow the metadata proxy to fetch addon manifests from private/internal IP ranges (Docker networks, DNS rewrites, reverse proxies). Only enable on trusted self-hosted instances behind a firewall.'),
    CUSTOM_HTML: optionalString(
        'Raw HTML injected at the top of the login/configuration page (hosted-instance banners, announcements).'),
    REGISTRATIONS_CLOSED: bool(false,
        'Block new account creation while existing users can still sign in.'),
    UNIFIED_ENFORCEMENT: bool(false,
        'Unify certain server-side enforcement checks across modules. Leave disabled for the default per-module behavior.'),

    // --- Logging ---
    LOG_LEVEL: enumString('info', ['fatal', 'error', 'warn', 'info', 'debug', 'trace'],
        'Server log verbosity: fatal, error, warn, info, debug or trace.'),
    LOG_PRETTY_PRINT: bool(true,
        'Pretty-print logs for humans (true) or emit JSON lines for log shippers (false). Recommended: false in production.'),

    // --- Proxy & image caching ---
    PROXY_CONCURRENCY_LIMIT: int(50, { min: 1 },
        'Maximum concurrent outbound proxy/metadata requests the server fans out.'),
    AIOSTREAMS_USER_API_THROTTLE_MS: int(1000, { min: 200, clampBelowMin: true },
        'Minimum interval in ms between calls to a single AIOStreams user API endpoint.'),
    IMAGE_PROXY_TIMEOUT_MS: int(4000, { min: 1000, clampBelowMin: true },
        'Per-request timeout in ms for the poster/image proxy. Lower fails fast so the shared queue drains instead of clogging on a slow image source.'),
    IMAGE_PROXY_QUEUE_LIMIT: int(150, { min: 30, clampBelowMin: true },
        'Max concurrent in-flight image-proxy requests; isolates poster storms from the stream/manifest proxies sharing the global queue.'),
    IMAGE_PROXY_THROTTLE_MS: int(25, { min: 0, clampBelowMin: true },
        'Minimum interval in ms between image-proxy calls to a single host. MetaHub is a CDN, so this stays far below the global throttle. 0 disables.'),
    IMAGE_CACHE_TTL_MS: int(86400000, { min: 0, clampBelowMin: true },
        'TTL in ms for the shared in-memory poster cache: hot posters serve from memory and identical cold requests collapse into one upstream fetch. 0 disables.'),
    IMAGE_CACHE_MAX_BYTES: int(134217728, { min: 0, clampBelowMin: true },
        'Total byte budget for the in-memory poster cache (bounded by bytes, not entry count). Default: 128 MB. 0 disables the cache.'),
    IMAGE_CACHE_MAX_ITEM_BYTES: int(524288, { min: 0, clampBelowMin: true },
        'Reject single cache entries larger than this many bytes. Default: 512 KB. 0 disables the limit.'),

    // --- Activity engine (opt-in) ---
    ACTIVITY_ENGINE_ENABLED: bool(false,
        'Opt in to server-side background polling that captures watch activity (events + snapshots) on a timer, so Activity/Replay history builds even with no client open. Multi-tenant warning: every account is polled each cycle (the write-amplification pattern behind the Midnight incident) — enable only on single-user/trusted instances. Client-side Activity tracking works without this.'),
    ACTIVITY_SCAN_INTERVAL_MS: int(300000, { min: 60000, clampBelowMin: true },
        'Base delay in ms between activity scans.'),
    ACTIVITY_SCAN_JITTER_MS: int(120000, { min: 0, clampBelowMin: true },
        'Random extra delay in ms (0..value) spread over accounts to avoid a thundering herd.'),
    ACTIVITY_INITIAL_DELAY_MS: int(30000, { min: 5000, clampBelowMin: true },
        'Delay in ms before the first scan after boot.'),
    ACTIVITY_CYCLE_BUDGET_MS: int(120000, { min: 10000, clampBelowMin: true },
        'Wall-clock budget in ms per scan cycle.'),
    ACTIVITY_MAX_ACCOUNTS_PER_CYCLE: int(50, { min: 1, clampBelowMin: true },
        'Hard cap on accounts scanned per cycle.'),
    ACTIVITY_MAX_EVENTS_PER_CYCLE: int(1000, { min: 1, clampBelowMin: true },
        'Hard cap on activity events written per cycle.'),
    ACTIVITY_MAX_SNAPSHOT_WRITES_PER_CYCLE: int(5000, { min: 1, clampBelowMin: true },
        'Hard cap on snapshot rows written per cycle.'),
    ACTIVITY_BATCH_SIZE: int(40, { min: 1, clampBelowMin: true },
        'Events accumulated before a batched database write.'),
    ACTIVITY_FETCH_TIMEOUT_MS: int(10000, { min: 1000, clampBelowMin: true },
        'Per-account fetch timeout in ms.'),
    ACTIVITY_HASH_CACHE_TTL_MS: int(86400000, { min: 60000, clampBelowMin: true },
        'TTL in ms for the per-account state-hash cache.'),
    ACTIVITY_HASH_CACHE_MAX: int(5000, { min: 100, clampBelowMin: true },
        'Maximum number of accounts tracked in the state-hash cache.'),

    // --- Autopilot engine ---
    AUTOPILOT_SCAN_CHUNK_SIZE: int(500, { min: 100, clampBelowMin: true },
        'Maximum rules scanned per autopilot cycle.'),
    AUTOPILOT_MAX_RULES_PER_CYCLE: int(10000, { min: 100, clampBelowMin: true },
        'Hard cap on rules processed in a single cycle. Autopilot only writes tiny timestamp updates, so large values are safe. Effectively max(scan chunk size, this value).'),
    AUTOPILOT_CYCLE_BUDGET_MS: int(120000, { min: 5000, clampBelowMin: true },
        'Wall-clock budget in ms per autopilot cycle. With 1000+ rules, 120s gives ample time for health checks.'),
    AUTOPILOT_HEALTH_CACHE_TTL_MS: int(30000, { min: 10000, clampBelowMin: true },
        'How long addon health-check results are cached, in ms.'),
    AUTOPILOT_RULE_RECHECK_MS: int(30000, { min: 10000, clampBelowMin: true },
        'Minimum interval in ms before a rule is re-evaluated.'),
    AUTOPILOT_RULE_CACHE_MAX_BYTES: int(268435456, { min: 0, clampBelowMin: true },
        'Byte budget for caching rules stable columns (addon_list/priority_chain) in memory so the worker stops re-reading them every cycle — a big win on remote databases (e.g. Supabase). Default: 256 MB. 0 disables.'),
    AUTOPILOT_RULE_CACHE_TTL_MS: int(600000, { min: 60000, clampBelowMin: true },
        'Safety-net TTL in ms for the rule cache. Invalidation is event-driven (writes bump updated_at); this only caps how long a stale entry could survive. Default: 10 minutes.'),

    // --- Internal / debug ---
    SQLITE_DB_PATH: optionalString(
        'INTERNAL: set programmatically by database/setup.js at boot (defaults to DATA_DIR/aio.db). Do not set manually.'),
    AIOMAN_TRACE: bool(false,
        'INTERNAL: request tracing to DATA_DIR/trace.log for debugging. Accepts 1/true/yes/on.'),
}

// Logical grouping used when generating .env.example (presentation only).
export const ENV_GROUPS = [
    { title: 'ESSENTIAL SETUP', vars: ['PORT', 'NODE_ENV', 'DATA_DIR', 'MAX_SYNC_PAYLOAD_SIZE'] },
    { title: 'DATABASE', note: 'Pool settings are ignored when DB_TYPE=sqlite.', vars: ['DB_TYPE', 'DATABASE_URL', 'DB_SSL_REJECT_UNAUTHORIZED', 'DB_POOL_SIZE', 'DB_CONNECTION_TIMEOUT', 'DB_MAX_RETRIES', 'READ_ONLY_REPLICA'] },
    { title: 'SECURITY', vars: ['ENCRYPTION_KEY', 'CORS_ORIGINS', 'SSRF_ALLOW_PRIVATE', 'CUSTOM_HTML', 'REGISTRATIONS_CLOSED', 'UNIFIED_ENFORCEMENT'] },
    { title: 'LOGGING', vars: ['LOG_LEVEL', 'LOG_PRETTY_PRINT'] },
    { title: 'PROXY & IMAGE CACHING', vars: ['PROXY_CONCURRENCY_LIMIT', 'AIOSTREAMS_USER_API_THROTTLE_MS', 'IMAGE_PROXY_TIMEOUT_MS', 'IMAGE_PROXY_QUEUE_LIMIT', 'IMAGE_PROXY_THROTTLE_MS', 'IMAGE_CACHE_TTL_MS', 'IMAGE_CACHE_MAX_BYTES', 'IMAGE_CACHE_MAX_ITEM_BYTES'] },
    { title: 'ACTIVITY ENGINE (OPT-IN)', note: 'Safe defaults shown — only relevant when you explicitly opt into server-side activity capture via ACTIVITY_ENGINE_ENABLED. Events are kept permanently so Activity can behave like Replay.', vars: ['ACTIVITY_ENGINE_ENABLED', 'ACTIVITY_SCAN_INTERVAL_MS', 'ACTIVITY_SCAN_JITTER_MS', 'ACTIVITY_INITIAL_DELAY_MS', 'ACTIVITY_CYCLE_BUDGET_MS', 'ACTIVITY_MAX_ACCOUNTS_PER_CYCLE', 'ACTIVITY_MAX_EVENTS_PER_CYCLE', 'ACTIVITY_MAX_SNAPSHOT_WRITES_PER_CYCLE', 'ACTIVITY_BATCH_SIZE', 'ACTIVITY_FETCH_TIMEOUT_MS', 'ACTIVITY_HASH_CACHE_TTL_MS', 'ACTIVITY_HASH_CACHE_MAX'] },
    { title: 'AUTOPILOT ENGINE', vars: ['AUTOPILOT_SCAN_CHUNK_SIZE', 'AUTOPILOT_MAX_RULES_PER_CYCLE', 'AUTOPILOT_CYCLE_BUDGET_MS', 'AUTOPILOT_HEALTH_CACHE_TTL_MS', 'AUTOPILOT_RULE_RECHECK_MS', 'AUTOPILOT_RULE_CACHE_MAX_BYTES', 'AUTOPILOT_RULE_CACHE_TTL_MS'] },
    { title: 'INTERNAL / DEBUG', note: 'Do not set these manually.', vars: ['SQLITE_DB_PATH', 'AIOMAN_TRACE'] },
]

export const serverSchema = Object.fromEntries(Object.entries(FIELDS).map(([name, field]) => [name, field.schema]))
export const ENV_META = Object.fromEntries(Object.entries(FIELDS).map(([name, field]) => [name, field.meta]))

// ---------------------------------------------------------------------------
// Validation. Runs once when this module is first imported (i.e. at boot,
// before the server starts listening).
// ---------------------------------------------------------------------------

export const env = createEnv({
    server: serverSchema,
    runtimeEnv: process.env,
    emptyStringAsUndefined: true,
    skipValidation: process.env.SKIP_ENV_VALIDATION === '1',
    onValidationError: (issues) => {
        const lines = issues.map((issue) => {
            const name = Array.isArray(issue.path) ? issue.path.join('.') : String(issue.path)
            const raw = process.env[name]
            // Never echo a value that might be a secret — print its length instead.
            const isSecretish = /KEY|SECRET|TOKEN|PASSWORD|URL|DSN/i.test(name)
            const got = raw === undefined || raw === ''
                ? ''
                : isSecretish ? ` (got value of length ${raw.length})` : ` (got '${raw}')`
            return `  - ${name} ${issue.message}${got}`
        })
        console.error(`Invalid environment:\n${lines.join('\n')}\nFix or unset the variable(s) above, then restart.`)
        process.exit(1)
    },
})

// One-line warning for unrecognized variables that look like typos of known
// ones (edit distance <= 2). Deliberately does not fail the boot: users have
// leftover variables from older versions or other tools.
function editDistance(a, b) {
    const m = a.length
    const n = b.length
    if (Math.abs(m - n) > 2) return 3 // cheap early exit; anything > 2 is ignored anyway
    let prev = Array.from({ length: n + 1 }, (_, j) => j)
    for (let i = 1; i <= m; i++) {
        const cur = [i]
        for (let j = 1; j <= n; j++) {
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
        }
        prev = cur
    }
    return prev[n]
}

function warnOnSuspiciousUnknowns() {
    const known = Object.keys(FIELDS)
    const suspicious = []
    for (const [name, value] of Object.entries(process.env)) {
        if (FIELDS[name] || value === '') continue
        if (!/^[A-Z][A-Z0-9_]*$/.test(name)) continue // skip npm_*/system/PascalCase noise
        let best = null
        let bestDistance = 3 // threshold: distance <= 2 counts as a likely typo
        for (const candidate of known) {
            const d = editDistance(name, candidate)
            if (d < bestDistance) {
                bestDistance = d
                best = candidate
            }
        }
        if (best) suspicious.push(`${name} (did you mean ${best}?)`)
    }
    if (suspicious.length) {
        console.warn(`Unrecognized environment variables that look like typos of known ones: ${suspicious.join(', ')}`)
    }
}

warnOnSuspiciousUnknowns()
