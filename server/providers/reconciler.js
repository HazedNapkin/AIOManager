import db from '../db.js'
import { decrypt } from '../crypto.js'
import { FALLBACK_KEYS } from '../keys.js'
import { trace } from '../utils/trace.js'
import { connectionEffectiveAddons, connectionExcludedUrls, chainGuardFailureWithExclusions } from '../utils/addon-destinations.js'
import { REFRESH_BUFFER_MS } from './token-refresh.js'

const BACKOFF_THRESHOLD = 3
const BACKOFF_SLOTS = [1, 2, 4, 8, 16]

// Cache owner-scoped connections briefly; credential writes invalidate the cache.
const connectionCache = new Map()
const storedConnections = new WeakMap()
const CONNECTION_CACHE_TTL_MS = 30 * 1000
let connectionCacheGeneration = 0

export function invalidateConnectionCache(syncUser = null) {
    connectionCacheGeneration++
    if (!syncUser) {
        connectionCache.clear()
        return
    }
    for (const [key, entry] of connectionCache) {
        if (entry.syncUser === syncUser) connectionCache.delete(key)
    }
}

function getBackoffSkip(consecutiveFailures) {
    if (consecutiveFailures < BACKOFF_THRESHOLD) return 0
    const slotIndex = Math.min(
        Math.floor(Math.log2(consecutiveFailures - BACKOFF_THRESHOLD + 1)),
        BACKOFF_SLOTS.length - 1
    )
    return BACKOFF_SLOTS[slotIndex]
}

const urlMemo = new Map()
function normalizeUrl(url) {
    if (!url) return ''
    const key = String(url)
    const cached = urlMemo.get(key)
    if (cached !== undefined) return cached
    let normalized = key.trim()
    normalized = normalized.replace(/^stremio:\/\//i, 'https://')
    normalized = normalized.replace(/\/manifest\.json$/i, '')
    normalized = normalized.replace(/\/+$/, '')
    normalized = normalized.toLowerCase()
    if (urlMemo.size >= 5000) urlMemo.clear()
    urlMemo.set(key, normalized)
    return normalized
}

// preferBaseUrled, scoped to ONE connection: a baseUrl-less bundle pushes to the public
// api.nuvio.tv, so a baseUrl-bearing dupe of the SAME connection always outranks a newer
// row that lost the instance URL. Distinct connection ids are distinct logins and are
// never compared.
function buildNativeConnection(type, row, accountId, bundle) {
    return {
        id: row.connection_id || `${accountId}:${type}`,
        platform: type,
        accountId,
        driverType: 'native',
        enabled: true,
        status: 'active',
        credentials: bundle,
        consecutiveFailures: 0,
        capabilities: type === 'nuvio' ? ['addons', 'plugins', 'profiles'] : ['addons'],
    }
}

async function resolveConnections(accountId, syncUser = null) {
    // Legacy rules need an owner before they may read provider credentials.
    if (!syncUser) {
        trace('reconciler', 'resolveConnections.skip', { accountId, reason: 'no-owner' })
        return []
    }
    const cacheKey = JSON.stringify([accountId, syncUser])
    const hit = connectionCache.get(cacheKey)
    if (hit && Date.now() - hit.at < CONNECTION_CACHE_TTL_MS) {
        const connections = structuredClone(hit.connections)
        for (const connection of connections) storedConnections.set(connection, connectionCacheGeneration)
        return connections
    }
    const generation = connectionCacheGeneration

    const rows = await db.query(
        'SELECT connection_id, auth_key, credential_type FROM server_credentials WHERE account_id = $1 AND sync_user = $2 ORDER BY updated_at DESC',
        [accountId, syncUser]
    )
    if (!rows || rows.length === 0) return []

    const connections = []
    // Multiplicity: every DISTINCT connection id resolves to its own connection (its own
    // sealed credential row). Only rows of the SAME connection dedupe — legacy per-device
    // duplicates of one login collapse to the newest row (ORDER BY updated_at DESC), so
    // the pre-multiplicity "one login per platform" shape survives for legacy data while
    // several logins on one platform never collapse into the most recent one.
    const platformRowIndexes = new Map()
    const seenHydra = new Set()
    const seenStremioAccountLevel = new Set()
    const seenStremioConnectionIds = new Set()
    const seenPlatforms = new Set()
    for (const row of rows) {
        if (!row.auth_key) continue
        const type = row.credential_type || 'stremio'

        if (type === 'hydra') {
            if (!row.connection_id || seenHydra.has(row.connection_id)) continue
            seenHydra.add(row.connection_id)
            let bundle = null
            try { bundle = JSON.parse(decrypt(row.auth_key, FALLBACK_KEYS)) } catch { continue }
            if (!bundle?.baseUrl) continue
            connections.push({
                id: row.connection_id,
                platform: 'hydra',
                accountId,
                driverType: 'hydra-outbound',
                enabled: bundle.enabled !== false,
                status: 'active',
                driverConfig: { baseUrl: bundle.baseUrl, authType: bundle.authType, authHeader: bundle.authHeader },
                credentials: { authValue: bundle.authValue },
                consecutiveFailures: 0,
                capabilities: ['addons']
            })
            continue
        }

        if (type === 'nuvio' || type === 'realstream') {
            let bundle = null
            try { bundle = JSON.parse(decrypt(row.auth_key, FALLBACK_KEYS)) } catch { continue }
            if (!bundle?.accessToken) continue
            // Rows without a connection id are the legacy per-device shape of ONE login:
            // they collapse to a single stable synth connection per platform.
            const rowKey = row.connection_id || `legacy:${type}`
            const mapKey = `${type}\u0000${rowKey}`
            const existingIdx = platformRowIndexes.get(mapKey)
            if (existingIdx !== undefined) {
                const incumbent = connections[existingIdx]
                if (!incumbent.credentials?.baseUrl && bundle.baseUrl) {
                    connections[existingIdx] = buildNativeConnection(type, row, accountId, bundle)
                }
                continue
            }
            platformRowIndexes.set(mapKey, connections.length)
            connections.push(buildNativeConnection(type, row, accountId, bundle))
            continue
        }

        if (type === 'stremio') {
            // Stremio uses a raw auth key string, not a JSON credential bundle. The
            // account-level row (no connection id) is the CANONICAL login mirror and keeps
            // the legacy `${accountId}:stremio` identity; each per-connection row is a
            // distinct secondary login resolved under the client's own connection id.
            const authKey = decrypt(row.auth_key, FALLBACK_KEYS)
            if (!authKey) continue
            if (!row.connection_id) {
                if (seenStremioAccountLevel.has(accountId)) continue
                seenStremioAccountLevel.add(accountId)
                connections.push({
                    id: `${accountId}:stremio`,
                    platform: 'stremio',
                    accountId,
                    driverType: 'native',
                    enabled: true,
                    status: 'active',
                    credentials: { authKey },
                    consecutiveFailures: 0,
                    capabilities: ['addons']
                })
                continue
            }
            if (seenStremioConnectionIds.has(row.connection_id)) continue
            seenStremioConnectionIds.add(row.connection_id)
            connections.push({
                id: row.connection_id,
                platform: 'stremio',
                accountId,
                driverType: 'native',
                enabled: true,
                status: 'active',
                credentials: { authKey },
                consecutiveFailures: 0,
                capabilities: ['addons']
            })
            continue
        }

        if (seenPlatforms.has(type)) continue
        seenPlatforms.add(type)
    }

    for (const connection of connections) connection.syncUser = syncUser
    // A write during the query must not repopulate the cache with an older view.
    if (generation === connectionCacheGeneration) {
        if (connectionCache.size >= 500) connectionCache.delete(connectionCache.keys().next().value)
        connectionCache.set(cacheKey, { at: Date.now(), syncUser, connections: structuredClone(connections) })
    }
    for (const connection of connections) storedConnections.set(connection, generation)
    return connections
}

const isHydraOutbound = (c) =>
    c?.platform === 'hydra' ||
    c?.driverType === 'hydra' || c?.driverType === 'hydra-outbound' ||
    c?.connectionType === 'hydra-outbound'

async function loadDriver(platform, credentials, connection) {
    if (platform === 'stremio' && !isHydraOutbound(connection)) {
        const { createStremioDriver } = await import('./stremio-driver.js')
        return createStremioDriver()
    }
    if (platform === 'nuvio') {
        const { createNuvioDriver } = await import('./nuvio-driver.js')
        const driver = createNuvioDriver({
            baseUrl: credentials.baseUrl,
            publishableKey: credentials.publishableKey
        })

        // client-marked expired: skip refresh (cooldown handles repeated auth failures)
        if (connection?.status === 'expired') {
            const err = new Error('Nuvio credentials expired, re-authenticate this connection')
            err.isAuthError = true
            throw err
        }

        if (connection?.id) {
            const expiresAt = connection.credentials?.expiresAt
            if (storedConnections.get(connection) !== connectionCacheGeneration || !expiresAt || expiresAt - Date.now() <= REFRESH_BUFFER_MS) {
                try {
                    const { refreshNuvioToken } = await import('./token-refresh.js')
                    const fresh = await refreshNuvioToken(connection.id, connection.accountId, undefined, connection.syncUser)
                    if (fresh) {
                        connection.credentials = {
                            ...connection.credentials,
                            accessToken: fresh.accessToken,
                            refreshToken: fresh.refreshToken,
                            expiresAt: fresh.expiresAt,
                            profileId: fresh.profileId ?? connection.credentials?.profileId,
                        }
                    }
                } catch (err) {
                    if (err.isAuthError || err._authExpired || err._credentialSuperseded) {
                        throw err
                    }
                }
            }
        }

        return driver
    }
    if (platform === 'realstream') {
        const { createRealStreamDriver } = await import('./realstream-driver.js')
        const driver = createRealStreamDriver({
            baseUrl: credentials.baseUrl
        })

        if (connection?.id) {
            const expiresAt = connection.credentials?.expiresAt
            if (storedConnections.get(connection) !== connectionCacheGeneration || !expiresAt || expiresAt - Date.now() <= REFRESH_BUFFER_MS) {
                try {
                    const { refreshRealStreamToken } = await import('./token-refresh.js')
                    const fresh = await refreshRealStreamToken(connection.id, connection.accountId, connection.syncUser)
                    if (fresh) {
                        connection.credentials = {
                            ...connection.credentials,
                            accessToken: fresh.accessToken,
                            userId: fresh.userId ?? connection.credentials?.userId,
                            expiresAt: fresh.expiresAt,
                        }
                    }
                } catch (err) {
                    if (err.isAuthError || err._authExpired || err._credentialSuperseded) {
                        throw err
                    }
                }
            }
        }

        return driver
    }
    if (connection && isHydraOutbound(connection)) {
        let authValue = connection.credentials?.authValue
        let config = connection.driverConfig
        if (authValue === undefined || !config?.baseUrl) {
            if (!connection.syncUser || !connection.accountId) return null
            const cred = await db.get(
                "SELECT auth_key FROM server_credentials WHERE connection_id = $1 AND credential_type = 'hydra' AND sync_user = $2 AND account_id = $3 LIMIT 1",
                [connection.id, connection.syncUser, connection.accountId]
            )
            if (cred?.auth_key) {
                const decrypted = decrypt(cred.auth_key, FALLBACK_KEYS)
                let bundle
                try { bundle = JSON.parse(decrypted) } catch { bundle = { authValue: decrypted } }
                if (!bundle || typeof bundle !== 'object') return null
                if (authValue === undefined) authValue = bundle.authValue
                if (!config?.baseUrl) config = { baseUrl: bundle.baseUrl, authType: bundle.authType, authHeader: bundle.authHeader }
            }
        }
        if (!config?.baseUrl) return null

        const { createHydraClient } = await import('../hydra/client.js')
        return await createHydraClient({ ...config, authValue })
    }
    return null
}

async function readPlatformAddons(driver, connection) {
    const c = connection.credentials
    if (connection.platform === 'stremio' && !isHydraOutbound(connection)) {
        return driver.readAddons(c.authKey)
    }
    if (connection.platform === 'nuvio') {
        return driver.readAddons(c.accessToken, c.profileId)
    }
    if (connection.platform === 'realstream') {
        return driver.readAddons(c.accessToken, c.userId)
    }
    if (isHydraOutbound(connection)) {
        return driver.readAddons()
    }
    return []
}
export function applyCustomMetadata(addon) {
    const meta = addon?.metadata
    if (!meta || (!meta.customName && !meta.customLogo && !meta.customDescription && !meta.hideConfigure)) return addon
    const manifest = addon.manifest || {}
    let updated = addon
    if (meta.customName || meta.customLogo || meta.customDescription) {
        updated = {
            ...addon,
            manifest: {
                ...manifest,
                name: meta.customName || manifest.name,
                logo: meta.customLogo || manifest.logo,
                description: meta.customDescription || manifest.description,
            },
        }
    }
    if (meta.hideConfigure) {
        const m = updated.manifest || {}
        updated = { ...updated, manifest: { ...m, behaviorHints: { ...m.behaviorHints, configurable: false } } }
    }
    return updated
}

function manifestSignature(m) {
    if (!m) return '{}'
    return JSON.stringify({
        id: m.id || '',
        version: m.version || '',
        types: m.types || [],
        resources: m.resources || [],
        catalogs: m.catalogs || []
    })
}

// Stable fingerprint of a canonical list over the diff-compared fields (url, manifest
// signature, custom name), sorted so list order never changes the hash. Consumed by
// auditConnections' fresh-in-sync skip; order-swap re-reads are indistinguishable to
// reconcileAccount's diff, so a skip armed under one is valid for the other.
function canonicalFingerprint(canonical) {
    return JSON.stringify(
        canonical.map(a => [
            normalizeUrl(a.transportUrl),
            manifestSignature(a.manifest),
            a?.metadata?.customName || ''
        ]).sort()
    )
}

// Minimum window in which a connection verifiably matching this exact canonical is not
// re-read by the audit (in-memory only; restart re-reads, the conservative direction).
const MIN_RECONCILE_INTERVAL_MS = 5 * 60 * 1000

// Platform writes replace the full addon list, so two writes racing on one connection
// land in nondeterministic order (route immediate-enforcement vs worker cycle vs client
// reconcile). Serialize per connection; different connections still run in parallel.
const platformWriteQueues = new Map()

function enqueuePlatformWrite(connection, run) {
    const key = connection.id || connection.platform
    const prev = platformWriteQueues.get(key) ?? Promise.resolve()
    const next = prev.catch(() => { }).then(run)
    platformWriteQueues.set(key, next)
    next.finally(() => {
        if (platformWriteQueues.get(key) === next) platformWriteQueues.delete(key)
    }).catch(() => { })
    return next
}

// An account runs one rule per addon chain, and every rule stores the ACCOUNT's whole addon
// list. Pushing that snapshot verbatim therefore rewrites the sibling chains from a copy that
// goes stale the moment the sibling rule swaps: last writer wins, and the loser's failover is
// reverted on the platform. Chain membership is stable, so the caller names the sibling chains;
// their *state* is mirrored from the platform here, which makes concurrent writers agree
// regardless of write order. URLs this rule does not manage are still written from the canonical
// list, so genuine additions are unaffected, and with no sibling chains this is a no-op.
// Only the NAMED members are mirrored: every other live row is one the canonical list
// deliberately omits (a retired addon mid-delete, a manual removal), and re-adding it would
// resurrect a deletion this write is supposed to land.
// `excludedUrls` (normalized) are this connection's destination-policy removals: a
// deliberately excluded member must never be mirrored back as a foreign row either.
async function reconcileForeignChains(driver, connection, canonical, requiredUrls, foreignChainUrls, excludedUrls = null) {
    const foreign = new Set((Array.isArray(foreignChainUrls) ? foreignChainUrls : []).map(u => normalizeUrl(u)))
    if (foreign.size === 0) return canonical
    const own = new Set((Array.isArray(requiredUrls) ? requiredUrls : []).map(u => normalizeUrl(u)))
    const excluded = excludedUrls instanceof Set && excludedUrls.size > 0 ? excludedUrls : null
    const urlOf = (a) => normalizeUrl(a?.transportUrl || a?.url || '')
    let live = []
    try {
        live = await readPlatformAddons(driver, connection)
    } catch (err) {
        // Conservative fallback: with no live read the stored snapshot is the only source.
        trace('reconciler', 'reconcileForeignChains.readFailed', { platform: connection.platform, error: err.message })
        return canonical
    }
    if (!Array.isArray(live) || live.length === 0) return canonical

    const out = canonical.filter(a => !foreign.has(urlOf(a)))
    const present = new Set(out.map(urlOf))
    for (const row of live) {
        const url = urlOf(row)
        // Mirror ONLY the named foreign-chain members. Any other live row is one the
        // canonical list deliberately omits (a retired addon mid-delete, a manual
        // removal); re-adding it would resurrect a deletion the write must land.
        if (!url || !foreign.has(url)) continue
        // Destination policy: a member this connection deliberately excludes is
        // intentionally absent — the mirror must not resurrect it.
        if (excluded && excluded.has(url)) continue
        if (present.has(url) || own.has(url)) continue
        if ((row.flags?.enabled ?? row.enabled) === false) continue
        present.add(url)
        out.push({
            transportUrl: row.transportUrl || row.url,
            manifest: row.manifest || { name: row.name || '' },
            flags: { ...(row.flags || {}), enabled: true },
        })
    }
    trace('reconciler', 'reconcileForeignChains.merged', { platform: connection.platform, foreign: foreign.size, count: out.length })
    return out
}

// `prep` runs inside the per-connection queue slot, so the read it needs, the guard it
// applies and the write that follows cannot interleave with another writer's (the read
// target is the platform's own list, which a concurrent writer would otherwise change
// between our read and our write). It returns { list } or { skip, reason }.
async function writePlatformAddons(driver, connection, addons, source, prep = null) {
    const c = connection.credentials
    return enqueuePlatformWrite(connection, async () => {
        let list = addons
        if (typeof prep === 'function') {
            const outcome = (await prep(addons)) || {}
            if (outcome.skip) return { skipped: true, reason: outcome.reason || 'prep-skip' }
            if (Array.isArray(outcome.list)) list = outcome.list
        }
        const prepared = (list || []).map(a => {
            const withMeta = applyCustomMetadata(a)
            // R9: drivers and the provider wire receive projected provider data only.
            // The internal destination policy never ships — unlike note/metadata it
            // is not user content for the platform.
            if (!withMeta?.destinations) return withMeta
            const { destinations, ...rest } = withMeta
            return rest
        })
        trace('reconciler', 'writePlatformAddons', { platform: connection.platform, source, count: prepared.length, urls: prepared.map(a => a.transportUrl || '') })
        if (connection.platform === 'stremio' && !isHydraOutbound(connection)) {
            if (!c?.authKey) { const e = new Error('Stremio credentials not loaded'); e.isAuthError = true; throw e }
            return driver.writeAddons(c.authKey, prepared)
        }
        if (connection.platform === 'nuvio') {
            if (!c?.accessToken) { const e = new Error('Nuvio credentials not loaded, re-authenticate this connection'); e.isAuthError = true; throw e }
            return driver.writeAddons(c.accessToken, prepared, c.profileId)
        }
        if (connection.platform === 'realstream') {
            if (!c?.accessToken) { const e = new Error('RealStream credentials not loaded, re-authenticate this connection'); e.isAuthError = true; throw e }
            return driver.writeAddons(c.accessToken, prepared, c.userId)
        }
        if (isHydraOutbound(connection)) {
            return driver.writeAddons(prepared)
        }
    })
}

function connectionKey(accountId, connectionId) {
    return `${accountId}:${connectionId}`
}

export function createReconciler(fastify) {
    const connectionState = new Map()
    const syncCycleCounters = new Map()

    const getState = (accountId, connId) => {
        return connectionState.get(connectionKey(accountId, connId)) || {
            consecutiveFailures: 0,
            lastError: null,
            lastErrorAt: null,
            lastSync: 0,
            status: 'active',
            skipCyclesRemaining: 0
        }
    }

    const setState = (accountId, connId, state) => {
        connectionState.set(connectionKey(accountId, connId), state)
    }

    const STATE_TTL_MS = 60 * 60 * 1000
    const MAX_ENTRIES = 10000
    let lastEvictAt = 0
    const evictStaleState = () => {
        const now = Date.now()
        if (now - lastEvictAt < STATE_TTL_MS) return
        lastEvictAt = now
        for (const [key, state] of connectionState.entries()) {
            const lastActivity = Math.max(state.lastSync, state.lastErrorAt || 0)
            const isStale = lastActivity > 0 && now - lastActivity > STATE_TTL_MS
            const isFailing = state.status === 'error' || (state.consecutiveFailures || 0) > 0
            if ((isStale && !isFailing) || (connectionState.size > MAX_ENTRIES && !isFailing)) {
                connectionState.delete(key)
            }
        }
    }

    const recordSuccess = (accountId, connId) => {
        const prev = getState(accountId, connId)
        setState(accountId, connId, {
            ...prev,
            consecutiveFailures: 0,
            lastError: null,
            lastErrorAt: null,
            lastSync: Date.now(),
            status: 'active',
            skipCyclesRemaining: 0
        })
        trace('reconciler', 'recordSuccess', { accountId, connectionId: connId })
    }

    const recordFailure = (accountId, connId, error, isAuthError) => {
        const prev = getState(accountId, connId)
        const consecutiveFailures = prev.consecutiveFailures + 1
        const status = isAuthError ? 'expired' : (consecutiveFailures >= BACKOFF_THRESHOLD ? 'error' : prev.status)
        const skipCyclesRemaining = getBackoffSkip(consecutiveFailures)

        setState(accountId, connId, {
            ...prev,
            consecutiveFailures,
            lastError: error.message || String(error),
            lastErrorAt: Date.now(),
            lastSync: prev.lastSync,
            status,
            skipCyclesRemaining
        })
        trace('reconciler', 'recordFailure', { accountId, connectionId: connId, consecutiveFailures, isAuthError, status, error: error.message || String(error) })
    }

    const EXPIRED_RETRY_COOLDOWN_MS = 30 * 60 * 1000 // 30 minutes; Supabase rate-limits auth to 6 req/min per IP. Hammering it gets users banned.
    const NETWORK_ERROR_COOLDOWN_MS = 2 * 60 * 1000  // 2 minutes for transient network issues

    const shouldSkip = (accountId, connId) => {
        // A fresh client collection write means the hub is momentarily behind the platforms.
        const writes = fastify.clientCollectionWrites
        if (writes) {
            const last = Math.max(
                writes.get(accountId) || 0,
                writes.get('Bulk Op') || 0,
                writes.get('Profile Swap') || 0,
                writes.get('Clear All') || 0
            )
            if (Date.now() - last < 20000) return true
        }
        const state = getState(accountId, connId)
        if (state.status === 'expired') {
            // Auth errors get a LONG cooldown. Supabase bans IPs that hit auth too frequently.
            const timeSinceError = state.lastErrorAt ? Date.now() - state.lastErrorAt : Infinity
            if (timeSinceError < EXPIRED_RETRY_COOLDOWN_MS) return true
        }
        if (state.status === 'error' && state.consecutiveFailures >= BACKOFF_THRESHOLD) {
            if (state.skipCyclesRemaining > 0) {
                setState(accountId, connId, { ...state, skipCyclesRemaining: state.skipCyclesRemaining - 1 })
                return true
            }
        }
        return false
    }

    const tickCycleCounter = (accountId) => {
        evictStaleState()
        const current = syncCycleCounters.get(accountId) || 0
        syncCycleCounters.set(accountId, current + 1)
    }

    const reconcileAccount = async (accountId, primaryConnectionId, connections, canonicalAddons, opts = {}) => {
        tickCycleCounter(accountId)
        const start = Date.now()
        const canonical = (Array.isArray(canonicalAddons) ? canonicalAddons : []).filter(a => a?.flags?.enabled !== false)
        trace('reconciler', 'reconcileAccount.start', { accountId, canonicalCount: canonical.length })

        // Stremio uses client-side sync pipeline, not server-side reconciliation
        const targetConnections = connections.filter(c => c.enabled && (isHydraOutbound(c) || c.platform !== 'stremio'))

        if ((canonical.length === 0 && !opts.allowCollectionShrink) || targetConnections.length === 0) {
            trace('reconciler', 'reconcileAccount.complete', { accountId, skipped: true, reason: targetConnections.length === 0 ? 'no-targets' : 'empty-canonical', timing: Date.now() - start })
            return { changes: [], canonical }
        }

        const canonicalManifestByUrl = new Map(
            canonical.map(a => [normalizeUrl(a.transportUrl), manifestSignature(a.manifest)])
        )
        const customNameByUrl = new Map(
            canonical
                .filter(a => a?.metadata?.customName)
                .map(a => [normalizeUrl(a.transportUrl), a.metadata.customName])
        )
        // Destination policy (per connection): every target projects its OWN effective
        // list from the canonical descriptors — the hub stays the single superset, a
        // row excluded for this login is simply absent from its write, including an
        // EMPTY write when every row is excluded there (policy-authorized clear, R2).
        // The global empty-canonical guard above is unchanged: a fully-empty
        // canonical list only reaches platforms with explicit allowCollectionShrink.
        const changes = []

        for (const connection of targetConnections) {
            const connId = connection.id
            if (shouldSkip(accountId, connId)) {
                fastify.log.debug({ category: 'Reconciler' }, `[${accountId}] Skipping ${connection.platform} (${connId}): in backoff`)
                continue
            }

            try {
                const driver = await loadDriver(connection.platform, connection.credentials || {}, connection)
                if (!driver) continue

                const effective = connectionEffectiveAddons(canonical, connection)
                const effectiveUrlSet = new Set(effective.map(a => normalizeUrl(a.transportUrl)))

                let needsWrite = true
                try {
                    const platformAddons = await readPlatformAddons(driver, connection)
                    const platformUrlSet = new Set(platformAddons.map(a => normalizeUrl(a.transportUrl || a.url)))
                    // E2 enforcement lives here: a platform row the policy excludes
                    // makes the sets differ, so the projected write REMOVES it.
                    const sameUrls = platformUrlSet.size === effectiveUrlSet.size && [...effectiveUrlSet].every(u => platformUrlSet.has(u))
                    if (sameUrls) {
                        const nameMismatch = customNameByUrl.size > 0 && platformAddons.some(p => {
                            const url = normalizeUrl(p.transportUrl || p.url)
                            const expected = customNameByUrl.get(url)
                            if (expected === undefined) return false
                            const platformName = p.manifest?.name ?? p.name
                            return platformName != null && platformName !== '' && platformName !== expected
                        })
                        const manifestMismatch = platformAddons.some(p => {
                            const url = normalizeUrl(p.transportUrl || p.url)
                            const canonicalManifest = canonicalManifestByUrl.get(url)
                            if (canonicalManifest === undefined) return false
                            if (!p.manifest) return false
                            return manifestSignature(p.manifest) !== canonicalManifest
                        })
                        needsWrite = nameMismatch || manifestMismatch
                    }
                } catch { /* can't read, assume needs write */ }

                if (needsWrite) {
                    await writePlatformAddons(driver, connection, effective, 'reconcile')
                    changes.push({ type: 'restore', url: '', platform: connection.platform, primary: false })
                }
                recordSuccess(accountId, connId)
            } catch (err) {
                recordFailure(accountId, connId, err, err.isAuthError)
                fastify.log.warn({ category: 'Reconciler' }, `[${accountId}] ${connection.platform} push failed: ${err.message}`)
            }
        }

        trace('reconciler', 'reconcileAccount.complete', { accountId, changes: changes.length, platforms: changes.map(c => c.platform), timing: Date.now() - start })
        return { changes, canonical }
    }

    const enforceAccount = async (accountId, connections, canonical, opts = {}) => {
        const { stremioWriter, requiredUrls, requiredActiveUrl } = opts
        tickCycleCounter(accountId)
        const canon = (Array.isArray(canonical) ? canonical : []).filter(a => a?.flags?.enabled !== false)
        const start = Date.now()
        trace('reconciler', 'enforceAccount.start', { accountId, canonicalCount: canon.length })
        const synced = []

        // Chain guard (spec F2): an enforced list that would drop every managed
        // chain member (all disabled -> "neither installed") or lose the active
        // tier must never reach a platform — EXCEPT when the dropped member is a
        // deliberate destination exclusion for THAT connection: the tolerant twin
        // (chainGuardFailureWithExclusions) waives exactly those, never globally
        // disabling the chain and never demanding a backup be enabled to
        // compensate. The guard now runs PER CONNECTION on that connection's
        // projected list; a data problem must not back off the connection
        // (skip means NO write, NO recordSuccess — arming the fresh-in-sync guard
        // with an unwritten list would poison it — and NO recordFailure).
        const managedChains = Array.isArray(opts.managedChains) && opts.managedChains.length > 0
            ? opts.managedChains
            : (Array.isArray(requiredUrls) && requiredUrls.length > 0 ? [{ urls: requiredUrls, target: requiredActiveUrl }] : [])
        let chainGuardSkipped = false

        for (const connection of (connections || []).filter(c => c.enabled)) {
            const connId = connection.id
            if (shouldSkip(accountId, connId)) {
                fastify.log.debug({ category: 'Reconciler' }, `[${accountId}] Skipping ${connection.platform} (${connId}): in backoff`)
                continue
            }
            try {
                // Per-connection destination projection: the enforced write carries
                // this login's effective list (canon minus its exclusions). Canon
                // non-empty with an EMPTY effective list is a policy-authorized
                // clear — the write removes the target's excluded copies (E2).
                // The guard's PRE list is the unfiltered canon: the exclusion
                // explanation ("every canon-carried member was deliberately
                // excluded HERE") is only derivable against the pre-projection set.
                const effective = connectionEffectiveAddons(canon, connection)
                const excludedUrls = connectionExcludedUrls(canon, connection)
                const preFailure = chainGuardFailureWithExclusions(canon, effective, managedChains, excludedUrls)
                if (preFailure) {
                    fastify.log.warn({ category: 'Reconciler' }, `[${accountId}] Chain guard: enforced list drops a managed chain (${preFailure}); skipping write.`)
                    trace('reconciler', 'enforceAccount.chainGuard', { accountId, platform: connection.platform, chains: managedChains.length, failure: preFailure })
                    chainGuardSkipped = true
                    continue
                }
                // A client-side Stremio writer takes priority; without one the server driver
                // writes Stremio itself (it holds the authKey), so an API-driven enforce —
                // e.g. an AIOMetadata "sync to all" push — can never silently skip Stremio.
                if (connection.platform === 'stremio' && !isHydraOutbound(connection) && stremioWriter) {
                    await stremioWriter(connection)
                } else {
                    if (canon.length === 0) continue
                    const driver = await loadDriver(connection.platform, connection.credentials || {}, connection)
                    if (!driver) continue
                    const outcome = await writePlatformAddons(driver, connection, effective, 'enforce', async (list) => {
                        const merged = await reconcileForeignChains(driver, connection, list, requiredUrls, opts.foreignChainUrls, excludedUrls)
                        // Belt-and-braces: no merge step may ride an excluded row
                        // back onto this connection's write (E2).
                        const finalList = excludedUrls.size > 0
                            ? merged.filter(a => !excludedUrls.has(normalizeUrl(a?.transportUrl || a?.url || '')))
                            : merged
                        // The foreign mirror rebuilds sibling-chain member sets from the
                        // live platform: a canon-carried FOREIGN member absent from the
                        // merged list is a by-design drop, not an accidental one.
                        const urlOf = (a) => normalizeUrl(a?.transportUrl || a?.url || '')
                        const preSet = new Set((list || []).map(urlOf).filter(Boolean))
                        const postSet = new Set((finalList || []).map(urlOf).filter(Boolean))
                        const byDesign = new Set()
                        for (const u of (Array.isArray(opts.foreignChainUrls) ? opts.foreignChainUrls : [])) {
                            const norm = normalizeUrl(u)
                            if (norm && preSet.has(norm) && !postSet.has(norm)) byDesign.add(norm)
                        }
                        const failure = chainGuardFailureWithExclusions(canon, finalList, managedChains, excludedUrls, byDesign)
                        if (failure) {
                            fastify.log.warn({ category: 'Reconciler' }, `[${accountId}] Chain guard: merged list would drop a managed chain (${failure}); skipping write.`)
                            return { skip: true, reason: failure }
                        }
                        return { list: finalList }
                    })
                    if (outcome && outcome.skipped) { chainGuardSkipped = true; continue }
                }
                recordSuccess(accountId, connId)
                synced.push(connection.platform)
            } catch (err) {
                recordFailure(accountId, connId, err, err.isAuthError)
                fastify.log.warn({ category: 'Reconciler' }, `[${accountId}] ${connection.platform} push failed: ${err.message}`)
            }
        }

        trace('reconciler', 'enforceAccount.complete', { accountId, synced, timing: Date.now() - start })
        return { synced, connectionStates: getConnectionStates(accountId), chainGuardSkipped }
    }

    // Nuvio instances that reject the optional plugins table; skip after the first 401
    const nuvioPluginsUnsupported = new Set()

    const reconcilePlugins = async (accountId, connection) => {
        if (connection.platform !== 'nuvio') return
        if (!connection.enabled) return
        if (shouldSkip(accountId, connection.id)) return
        if (nuvioPluginsUnsupported.has(connection.id)) return

        const driver = await loadDriver(connection.platform, connection.credentials || {}, connection)
        if (!driver || !driver.readPlugins) return
        if (!connection.credentials?.accessToken) return

        const canonicalPlugins = connection.pluginList || []

        try {
            const platformPlugins = await driver.readPlugins(
                connection.credentials.accessToken,
                connection.credentials.profileId
            )

            const canonicalUrls = new Set(canonicalPlugins.map(p => normalizeUrl(p.url)))
            const platformUrls = new Set(platformPlugins.map(p => normalizeUrl(p.url)))

            const needsPush = platformUrls.size !== canonicalUrls.size ||
                [...canonicalUrls].some(u => !platformUrls.has(u)) ||
                [...platformUrls].some(u => !canonicalUrls.has(u))

            if (needsPush && canonicalPlugins.length > 0) {
                await driver.writePlugins(
                    connection.credentials.accessToken,
                    canonicalPlugins,
                    connection.credentials.profileId
                )
            }
            recordSuccess(accountId, connection.id)
        } catch (err) {
            if (err.isAuthError) {
                // Token was just refreshed, so this 401 means plugins aren't offered on this instance
                nuvioPluginsUnsupported.add(connection.id)
                fastify.log.debug({ category: 'Reconciler' }, `[${accountId}] Nuvio plugins unavailable on this instance (auth rejected); skipping plugin sync.`)
                return
            }
            recordFailure(accountId, connection.id, err, false)
            fastify.log.warn({ category: 'Reconciler' }, `[${accountId}] Nuvio plugin sync failed: ${err.message}`)
        }
    }

    // Deep-audit read path for connection-only rules: returns each connection's live
    // collection via the same driver/read machinery as reconcileAccount, without
    // writing. A connection in backoff or fresh-verified in-sync for this exact
    // canonical (the #19 guard) is skipped, never fought. Read errors surface as
    // skipped entries with no recordFailure — the audit observes, it does not punish.
    const auditConnections = async (accountId, connections, canonical) => {
        const canon = (Array.isArray(canonical) ? canonical : []).filter(a => a?.flags?.enabled !== false)
        const canonHash = canonicalFingerprint(canon)
        const results = []
        for (const connection of (connections || []).filter(c => c.enabled)) {
            const connId = connection.id
            if (shouldSkip(accountId, connId)) {
                results.push({ connectionId: connId, platform: connection.platform, skipped: 'backoff' })
                continue
            }
            const state = getState(accountId, connId)
            if (
                state.lastInSync === true &&
                state.lastCanonicalHash === canonHash &&
                Date.now() - (state.lastSync || 0) < MIN_RECONCILE_INTERVAL_MS
            ) {
                trace('reconciler', 'audit-skip', { accountId, connectionId: connId, reason: 'fresh-in-sync' })
                results.push({ connectionId: connId, platform: connection.platform, skipped: 'fresh-in-sync' })
                continue
            }
            try {
                const driver = await loadDriver(connection.platform, connection.credentials || {}, connection)
                if (!driver) {
                    results.push({ connectionId: connId, platform: connection.platform, skipped: 'no-driver' })
                    continue
                }
                const addons = await readPlatformAddons(driver, connection)
                results.push({ connectionId: connId, platform: connection.platform, addons: Array.isArray(addons) ? addons : [] })
            } catch (err) {
                trace('reconciler', 'audit-connection-error', { accountId, connectionId: connId, error: err?.message || String(err) })
                results.push({ connectionId: connId, platform: connection.platform, skipped: 'read-error' })
            }
        }
        return results
    }

    const getConnectionStates = (accountId) => {
        const states = {}
        for (const [key, state] of connectionState.entries()) {
            if (key.startsWith(`${accountId}:`)) {
                states[key.split(':').slice(1).join(':')] = { ...state }
            }
        }
        return states
    }

    return {
        reconcileAccount,
        enforceAccount,
        reconcilePlugins,
        auditConnections,
        resolveConnections,
        getConnectionStates,
        recordSuccess,
        recordFailure,
        getState
    }
}
