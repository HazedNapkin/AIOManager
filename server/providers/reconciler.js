import db from '../db.js'
import { decrypt } from '../crypto.js'
import { FALLBACK_KEYS } from '../keys.js'

const BACKOFF_THRESHOLD = 3
const BACKOFF_SLOTS = [1, 2, 4, 8, 16]

function getBackoffSkip(consecutiveFailures) {
    if (consecutiveFailures < BACKOFF_THRESHOLD) return 0
    const slotIndex = Math.min(
        Math.floor(Math.log2(consecutiveFailures - BACKOFF_THRESHOLD + 1)),
        BACKOFF_SLOTS.length - 1
    )
    return BACKOFF_SLOTS[slotIndex]
}

function normalizeUrl(url) {
    if (!url) return ''
    let normalized = url.trim()
    normalized = normalized.replace(/^stremio:\/\//i, 'https://')
    normalized = normalized.replace(/\/manifest\.json$/i, '')
    normalized = normalized.replace(/\/+$/, '')
    return normalized.toLowerCase()
}

function diffAddons(canonical, platform) {
    const canonicalUrls = new Map(canonical.map(a => [normalizeUrl(a.transportUrl), a]))
    const platformUrls = new Map(platform.map(a => [normalizeUrl(a.transportUrl || a.url), a]))

    const additions = []
    for (const [url, addon] of platformUrls) {
        if (!canonicalUrls.has(url)) {
            additions.push({ url, addon })
        }
    }

    const missing = []
    for (const [url, addon] of canonicalUrls) {
        if (!platformUrls.has(url)) {
            missing.push({ url, addon })
        }
    }

    return { additions, missing, canonicalUrls, platformUrls }
}

// syncUser scopes the lookup to the owning user. The HTTP endpoint (providers.js) MUST pass the
// authenticated user so a caller can't resolve another user's stored credentials by accountId
// (cross-tenant IDOR). Server-trusted callers (the autopilot worker, which derives account_id from
// owner-scoped rules) may omit it.
async function resolveConnections(accountId, syncUser = null) {
    const rows = await db.query(
        syncUser
            ? 'SELECT connection_id, auth_key, credential_type FROM server_credentials WHERE account_id = $1 AND sync_user = $2 ORDER BY updated_at DESC'
            : 'SELECT connection_id, auth_key, credential_type FROM server_credentials WHERE account_id = $1 ORDER BY updated_at DESC',
        syncUser ? [accountId, syncUser] : [accountId]
    )
    if (!rows || rows.length === 0) return []

    const connections = []
    const seenPlatforms = new Set()
    for (const row of rows) {
        if (!row.auth_key) continue
        const type = row.credential_type || 'stremio'
        // one connection per platform; keep the most recent (older rows are stale per-device dupes)
        if (seenPlatforms.has(type)) continue
        seenPlatforms.add(type)

        // Stremio uses raw auth key string, not JSON credential bundle
        if (type === 'stremio') {
            const authKey = decrypt(row.auth_key, FALLBACK_KEYS)
            if (authKey) {
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
            }
        } else if (type === 'nuvio' || type === 'realstream') {
            let bundle = null
            try { bundle = JSON.parse(decrypt(row.auth_key, FALLBACK_KEYS)) } catch { continue }
            if (bundle?.accessToken) {
                // enabled defaults true: the connection's enabled flag isn't stored server-side yet
                connections.push({
                    id: row.connection_id,
                    platform: type,
                    accountId,
                    driverType: 'native',
                    enabled: true,
                    status: 'active',
                    credentials: bundle,
                    consecutiveFailures: 0,
                    capabilities: type === 'nuvio' ? ['addons', 'plugins', 'profiles'] : ['addons']
                })
            }
        }
    }

    return connections
}

async function loadDriver(platform, credentials, connection) {
    // Stremio uses a separate driver module with different API contract
    if (platform === 'stremio') {
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
            try {
                const { refreshNuvioToken } = await import('./token-refresh.js')
                const fresh = await refreshNuvioToken(connection.id, connection.accountId)
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
                if (err.isAuthError || err._authExpired) {
                    throw err
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
            try {
                const { refreshRealStreamToken } = await import('./token-refresh.js')
                const fresh = await refreshRealStreamToken(connection.id)
                if (fresh) {
                    connection.credentials = {
                        ...connection.credentials,
                        accessToken: fresh.accessToken,
                        userId: fresh.userId ?? connection.credentials?.userId,
                        expiresAt: fresh.expiresAt,
                    }
                }
            } catch (err) {
                if (err.isAuthError || err._authExpired) {
                    throw err
                }
            }
        }

        return driver
    }
    if (platform === 'hydra' || (connection && (connection.driverType === 'hydra' || connection.driverType === 'hydra-outbound'))) {
        const config = connection?.driverConfig
        if (!config?.baseUrl) return null

        const cred = await db.get(
            "SELECT auth_key FROM server_credentials WHERE connection_id = $1 AND credential_type = 'hydra' LIMIT 1",
            [connection.id]
        )
        const authValue = cred?.auth_key ? decrypt(cred.auth_key, FALLBACK_KEYS) : undefined

        const { createHydraClient } = await import('../hydra/client.js')
        return await createHydraClient({ ...config, authValue })
    }
    return null
}

async function readPlatformAddons(driver, connection) {
    const c = connection.credentials
    // Stremio API takes single authKey param (no profile/user context)
    if (connection.platform === 'stremio') {
        return driver.readAddons(c.authKey)
    }
    if (connection.platform === 'nuvio') {
        return driver.readAddons(c.accessToken, c.profileId)
    }
    if (connection.platform === 'realstream') {
        return driver.readAddons(c.accessToken, c.userId)
    }
    return []
}

async function writePlatformAddons(driver, connection, addons) {
    const c = connection.credentials
    // Stremio API takes (authKey, addons) — no profile/user context
    if (connection.platform === 'stremio') {
        if (!c?.authKey) { const e = new Error('Stremio credentials not loaded'); e.isAuthError = true; throw e }
        return driver.writeAddons(c.authKey, addons)
    }
    if (connection.platform === 'nuvio') {
        if (!c?.accessToken) { const e = new Error('Nuvio credentials not loaded, re-authenticate this connection'); e.isAuthError = true; throw e }
        return driver.writeAddons(c.accessToken, addons, c.profileId)
    }
    if (connection.platform === 'realstream') {
        if (!c?.accessToken) { const e = new Error('RealStream credentials not loaded, re-authenticate this connection'); e.isAuthError = true; throw e }
        return driver.writeAddons(c.accessToken, addons, c.userId)
    }
    if (connection.platform === 'hydra' || connection.driverType === 'hydra' || connection.driverType === 'hydra-outbound') {
        return driver.writeAddons(addons)
    }
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
    let lastEvictAt = 0
    const evictStaleState = () => {
        const now = Date.now()
        if (now - lastEvictAt < STATE_TTL_MS) return
        lastEvictAt = now
        for (const [key, state] of connectionState.entries()) {
            if (state.status === 'active' && state.consecutiveFailures === 0 && state.lastSync > 0 && now - state.lastSync > STATE_TTL_MS) {
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
    }

    const EXPIRED_RETRY_COOLDOWN_MS = 30 * 60 * 1000 // 30 minutes; Supabase rate-limits auth to 6 req/min per IP. Hammering it gets users banned.
    const NETWORK_ERROR_COOLDOWN_MS = 2 * 60 * 1000  // 2 minutes for transient network issues

    const shouldSkip = (accountId, connId) => {
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

    const reconcileAccount = async (accountId, primaryConnectionId, connections, canonicalAddons) => {
        tickCycleCounter(accountId)

        const canonical = Array.isArray(canonicalAddons) ? canonicalAddons : []
        const enabledCanonical = canonical.filter(a => a?.flags?.enabled !== false)

        // Stremio uses client-side sync pipeline, not server-side reconciliation
        const targetConnections = connections.filter(c => c.enabled && c.platform !== 'stremio')

        if (enabledCanonical.length === 0 || targetConnections.length === 0) {
            return { changes: [], canonical }
        }

        const canonicalUrlSet = new Set(enabledCanonical.map(a => normalizeUrl(a.transportUrl)))
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

                let needsWrite = true
                try {
                    const platformAddons = await readPlatformAddons(driver, connection)
                    const platformUrlSet = new Set(platformAddons.map(a => normalizeUrl(a.transportUrl || a.url)))
                    if (platformUrlSet.size === canonicalUrlSet.size && [...canonicalUrlSet].every(u => platformUrlSet.has(u))) {
                        needsWrite = false
                    }
                } catch { /* can't read, assume needs write */ }

                if (needsWrite) {
                    await writePlatformAddons(driver, connection, enabledCanonical)
                    changes.push({ type: 'restore', url: '', platform: connection.platform, primary: false })
                }
                recordSuccess(accountId, connId)
            } catch (err) {
                recordFailure(accountId, connId, err, err.isAuthError)
                fastify.log.warn({ category: 'Reconciler' }, `[${accountId}] ${connection.platform} push failed: ${err.message}`)
            }
        }

        return { changes, canonical }
    }

    const enforceAccount = async (accountId, connections, canonical, opts = {}) => {
        const { stremioWriter } = opts
        tickCycleCounter(accountId)
        const canon = Array.isArray(canonical) ? canonical : []
        const enabledCanonical = canon.filter(a => a?.flags?.enabled !== false)
        const synced = []

        for (const connection of (connections || []).filter(c => c.enabled)) {
            const connId = connection.id
            if (shouldSkip(accountId, connId)) {
                fastify.log.debug({ category: 'Reconciler' }, `[${accountId}] Skipping ${connection.platform} (${connId}): in backoff`)
                continue
            }
            try {
                // Stremio uses client-side writer callback instead of server driver
                if (connection.platform === 'stremio') {
                    if (!stremioWriter) continue
                    await stremioWriter(connection)
                } else {
                    if (enabledCanonical.length === 0) continue
                    const driver = await loadDriver(connection.platform, connection.credentials || {}, connection)
                    if (!driver) continue
                    await writePlatformAddons(driver, connection, enabledCanonical)
                }
                recordSuccess(accountId, connId)
                synced.push(connection.platform)
            } catch (err) {
                recordFailure(accountId, connId, err, err.isAuthError)
                fastify.log.warn({ category: 'Reconciler' }, `[${accountId}] ${connection.platform} push failed: ${err.message}`)
            }
        }

        return { synced, connectionStates: getConnectionStates(accountId) }
    }

    const reconcilePlugins = async (accountId, connection) => {
        if (connection.platform !== 'nuvio') return
        if (!connection.enabled) return
        if (shouldSkip(accountId, connection.id)) return

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
                recordSuccess(accountId, connection.id)
            }
        } catch (err) {
            recordFailure(accountId, connection.id, err, err.isAuthError)
            fastify.log.warn({ category: 'Reconciler' }, `[${accountId}] Nuvio plugin sync failed: ${err.message}`)
        }
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
        resolveConnections,
        getConnectionStates,
        recordSuccess,
        recordFailure,
        getState
    }
}
