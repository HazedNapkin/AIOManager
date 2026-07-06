import { createHash } from 'node:crypto'
import db from '../db.js'
import { hashApiKey } from '../api-keys.js'
import { isSafeUrl, isSafeUrlResolved } from '../utils/ssrf.js'
import { decrypt } from '../crypto.js'
import { FALLBACK_KEYS } from '../keys.js'
import { VERSION } from '../config.js'
import { enqueueProxyRequest } from '../proxy-queue.js'
import { writeEncryptedIfChanged } from '../db-guards.js'
import { normalizeAddonUrl } from '../utils/addon-url.js'

const HYDRA_SPEC_VERSION = '1.0.0'
const MAX_ADDON_URL_LENGTH = 2048
const MAX_ADDONS_IN_COLLECTION = 500
const LAST_USED_COALESCE_MS = 60_000

let logger = console

const isValidAddonUrl = (url) =>
    typeof url === 'string' &&
    url.length <= MAX_ADDON_URL_LENGTH &&
    isSafeUrl(url)

const isValidLogoUrl = (url) =>
    typeof url === 'string' &&
    url.length <= MAX_ADDON_URL_LENGTH &&
    isSafeUrl(url)

async function lookupAccountByApiKey(request, reply) {
    const rawKey = request.headers['x-api-key']
    if (!rawKey || typeof rawKey !== 'string') {
        reply.code(401).send({ error: 'unauthorized', message: 'Missing X-API-Key header' })
        return null
    }

    const keyHash = hashApiKey(rawKey)
    const row = await db.get(
        'SELECT account_id, sync_user, last_used_at FROM account_api_keys WHERE api_key_hash = $1',
        [keyHash]
    )
    if (!row) {
        reply.code(401).send({ error: 'unauthorized', message: 'Invalid API key' })
        return null
    }

    const now = Date.now()
    if (!row.last_used_at || now - row.last_used_at >= LAST_USED_COALESCE_MS) {
        db.run(
            'UPDATE account_api_keys SET last_used_at = $1 WHERE api_key_hash = $2',
            [now, keyHash]
        ).catch(() => {})
    }

    return row
}

// syncUser comes from the API-key lookup, not the request. Every query is scoped to it so a key
// maliciously registered against another user's accountId (account_api_keys is populated from the
// client sync blob) resolves only to the key owner's own data -- never the victim's credentials,
// canonical store, or autopilot rule.
async function getCanonicalAddons(accountId, syncUser) {
    // Stremio accounts are served Stremio-first (the most mature path). Filter to the Stremio
    // credential so a Nuvio/Hydra credential row doesn't get mis-used as a Stremio authKey.
    const cred = await db.get(
        "SELECT auth_key FROM server_credentials WHERE account_id = $1 AND sync_user = $2 AND (credential_type = 'stremio' OR credential_type IS NULL) ORDER BY updated_at DESC LIMIT 1",
        [accountId, syncUser]
    )
    if (cred?.auth_key) {
        const mixed = await db.get(
            "SELECT 1 FROM server_credentials WHERE account_id = $1 AND sync_user = $2 AND credential_type IN ('nuvio', 'realstream', 'hydra') LIMIT 1",
            [accountId, syncUser]
        )
        if (mixed) {
            logger.warn({ category: 'Hydra' }, `[${accountId}] Account has both Stremio and non-Stremio credentials; inbound reads prefer Stremio and may not reflect the non-Stremio setup.`)
        }
        const authKey = decrypt(cred.auth_key, FALLBACK_KEYS)
        if (authKey) {
            try {
                const { createStremioDriver } = await import('../providers/stremio-driver.js')
                const driver = createStremioDriver()
                return await driver.readAddons(authKey)
            } catch {}
        }
    }

    // Hub canonical: the inbound source for accounts the server can't read via Stremio
    // (Nuvio-only / local-only). Written by the client on sync (account_canonical_addons).
    // An empty array here is authoritative: the Hub genuinely has no addons.
    const canonical = await db.get(
        'SELECT addon_list FROM account_canonical_addons WHERE account_id = $1 AND sync_user = $2',
        [accountId, syncUser]
    )
    if (canonical?.addon_list) {
        const decrypted = decrypt(canonical.addon_list, FALLBACK_KEYS)
        if (decrypted) {
            try {
                const parsed = JSON.parse(decrypted)
                if (Array.isArray(parsed)) return parsed
            } catch {}
        }
    }

    const rules = await db.query(
        'SELECT addon_list FROM autopilot_rules WHERE account_id = $1 AND owner_sync_user = $2 AND is_active = 1 ORDER BY updated_at DESC LIMIT 1',
        [accountId, syncUser]
    )
    if (rules.length > 0 && rules[0].addon_list) {
        const decrypted = decrypt(rules[0].addon_list, FALLBACK_KEYS)
        if (decrypted) {
            const parsed = JSON.parse(decrypted)
            if (Array.isArray(parsed) && parsed.length > 0) return parsed
        }
    }

    return []
}

function computeAddonsVersion(hydraAddons) {
    return createHash('sha256').update(JSON.stringify(hydraAddons)).digest('hex').slice(0, 16)
}

function toHydraAddon(raw) {
    if (!raw || typeof raw !== 'object') return null
    const manifest = raw.manifest || raw
    return {
        transportUrl: raw.transportUrl || raw.url || '',
        name: manifest.name || raw.name || '',
        version: manifest.version || '',
        logo: manifest.logo || '',
        enabled: (raw.flags?.enabled ?? raw.enabled) !== false,
        types: manifest.types || [],
        resources: manifest.resources || []
    }
}

async function writeCanonicalAddons(account, addons) {
    const accountId = account.account_id
    const syncUser = account.sync_user || ''

    // Stremio Hubs write through to Stremio (the mature path). Filter to the Stremio
    // credential so a Nuvio/Hydra cred isn't mis-used as a Stremio authKey. The same
    // bug class fixed on the read side in getCanonicalAddons. Scoped to sync_user so a
    // poisoned api-key mapping can't push to another user's Stremio collection.
    const cred = await db.get(
        "SELECT auth_key FROM server_credentials WHERE account_id = $1 AND sync_user = $2 AND (credential_type = 'stremio' OR credential_type IS NULL) ORDER BY updated_at DESC LIMIT 1",
        [accountId, syncUser]
    )
    if (cred?.auth_key) {
        const mixed = await db.get(
            "SELECT 1 FROM server_credentials WHERE account_id = $1 AND sync_user = $2 AND credential_type IN ('nuvio', 'realstream', 'hydra') LIMIT 1",
            [accountId, syncUser]
        )
        if (mixed) {
            logger.warn({ category: 'Hydra' }, `[${accountId}] Account has both Stremio and non-Stremio credentials; inbound writes go to Stremio and may bypass the non-Stremio setup.`)
        }
        const authKey = decrypt(cred.auth_key, FALLBACK_KEYS)
        if (!authKey) throw new Error('Failed to decrypt credentials')
        const { createStremioDriver } = await import('../providers/stremio-driver.js')
        const driver = createStremioDriver()
        await driver.writeAddons(authKey, addons)
        return
    }

    // Non-Stremio Hub (Nuvio-only / local-only): the inbound write lands in the
    // server-readable canonical store. The client folds it into the Hub on its next
    // sync via a three-way merge; the server stays a dumb store, the client is the
    // single merger (D2). Midnight-safe: writeEncryptedIfChanged compares plaintext
    // and no-ops when unchanged. The row is upserted first so an inbound write to an
    // account the client has synced at least once always lands.
    const now = Date.now()
    await db.run(
        db.type === 'postgres'
            ? 'INSERT INTO account_canonical_addons (account_id, sync_user, updated_at) VALUES ($1, $2, $3) ON CONFLICT (account_id) DO NOTHING'
            : 'INSERT OR IGNORE INTO account_canonical_addons (account_id, sync_user, updated_at) VALUES ($1, $2, $3)',
        [accountId, syncUser, now]
    )
    // WHERE scoped to sync_user: if the row is owned by another user (the account_id PK already
    // exists), this update matches nothing rather than overwriting their canonical list.
    await writeEncryptedIfChanged(
        'account_canonical_addons',
        { sql: 'account_id = $1 AND sync_user = $2', params: [accountId, syncUser] },
        'addon_list',
        JSON.stringify(addons),
        { alsoSet: { sync_user: syncUser, updated_at: now } }
    )
}

async function validateManifest(manifestUrl) {
    if (!(await isSafeUrlResolved(manifestUrl))) {
        return { valid: false, errors: ['Unsafe or private manifest URL'] }
    }
    const res = await enqueueProxyRequest(manifestUrl, () => fetch(manifestUrl, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000)
    }))
    if (!res.ok) {
        return { valid: false, errors: [`Manifest fetch returned HTTP ${res.status}`] }
    }
    let manifest
    try {
        manifest = await res.json()
    } catch {
        return { valid: false, errors: ['Manifest is not valid JSON'] }
    }

    const errors = []
    if (!manifest.id || typeof manifest.id !== 'string') errors.push('Missing or invalid "id"')
    if (!manifest.name || typeof manifest.name !== 'string') errors.push('Missing or invalid "name"')
    if (!manifest.version || typeof manifest.version !== 'string') errors.push('Missing or invalid "version"')
    if (!Array.isArray(manifest.resources) || manifest.resources.length === 0) errors.push('Missing or empty "resources"')
    if (!Array.isArray(manifest.types) || manifest.types.length === 0) errors.push('Missing or empty "types"')

    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined, manifest }
}

export function registerHydraRoutes(fastify, reconciler = null) {
    logger = fastify.log

    fastify.get('/hydra/status', {
        config: { rateLimit: { max: 120, timeWindow: '1 minute' } }
    }, async () => {
        return {
            name: 'AIOManager',
            version: HYDRA_SPEC_VERSION,
            platformVersion: VERSION,
            capabilities: ['addons', 'sync', 'validate']
        }
    })

    fastify.post('/hydra/register', {
        bodyLimit: 1024 * 10,
        config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        const account = await lookupAccountByApiKey(request, reply)
        if (!account) return

        const name = String(request.body?.name || 'Unknown').slice(0, 64)
        const logo = isValidLogoUrl(request.body?.logo) ? request.body.logo : null
        const id = `${account.account_id}:${name}`
        const now = Date.now()

        await db.run(
            `INSERT INTO hydra_subscribers (id, account_id, sync_user, name, logo, created_at, last_seen_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (id) DO UPDATE SET logo = excluded.logo, last_seen_at = excluded.last_seen_at`,
            [id, account.account_id, account.sync_user || '', name, logo, now, now]
        )
        return { ok: true }
    })

    fastify.get('/hydra/version', {
        config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        const account = await lookupAccountByApiKey(request, reply)
        if (!account) return
        try {
            const raw = await getCanonicalAddons(account.account_id, account.sync_user)
            const addons = raw.map(toHydraAddon).filter(Boolean)
            return { version: computeAddonsVersion(addons) }
        } catch {
            reply.code(500)
            return { error: 'internal_error', message: 'Failed to read version' }
        }
    })

    fastify.get('/hydra/addons', {
        config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        const account = await lookupAccountByApiKey(request, reply)
        if (!account) return

        try {
            const raw = await getCanonicalAddons(account.account_id, account.sync_user)
            const addons = raw.map(toHydraAddon).filter(Boolean)
            return { addons }
        } catch {
            reply.code(500)
            return { error: 'internal_error', message: 'Sync failed' }
        }
    })

    fastify.post('/hydra/addons', {
        bodyLimit: 1024 * 100,
        config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        const account = await lookupAccountByApiKey(request, reply)
        if (!account) return

        const { url } = request.body || {}
        if (!url || !isValidAddonUrl(url)) {
            reply.code(400)
            return { error: 'bad_request', message: 'Invalid or missing addon URL' }
        }

        try {
            const current = await getCanonicalAddons(account.account_id, account.sync_user)
            const norm = normalizeAddonUrl(url)
            if (current.some(a => normalizeAddonUrl(a.transportUrl || a.url || '') === norm)) {
                const addons = current.map(toHydraAddon).filter(Boolean)
                return { addons }
            }

            const { valid, manifest } = await validateManifest(url)
            if (!valid) {
                reply.code(400)
                return { error: 'bad_request', message: 'Failed to fetch valid manifest from URL' }
            }

            const newAddon = { transportUrl: url, manifest }
            const updated = [...current, newAddon]
            await writeCanonicalAddons(account, updated)

            return { addons: updated.map(toHydraAddon).filter(Boolean) }
        } catch {
            reply.code(500)
            return { error: 'internal_error', message: 'Failed to install addon' }
        }
    })

    fastify.delete('/hydra/addons', {
        config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        const account = await lookupAccountByApiKey(request, reply)
        if (!account) return

        const url = request.query.url
        if (!url || !isValidAddonUrl(url)) {
            reply.code(400)
            return { error: 'bad_request', message: 'Invalid or missing addon URL' }
        }

        try {
            const current = await getCanonicalAddons(account.account_id, account.sync_user)
            const norm = normalizeAddonUrl(url)
            const filtered = current.filter(a => normalizeAddonUrl(a.transportUrl || a.url || '') !== norm)

            if (filtered.length === current.length) {
                reply.code(404)
                return { error: 'not_found', message: 'Addon not installed' }
            }

            await writeCanonicalAddons(account, filtered)
            return { addons: filtered.map(toHydraAddon).filter(Boolean) }
        } catch {
            reply.code(500)
            return { error: 'internal_error', message: 'Failed to remove addon' }
        }
    })

    fastify.put('/hydra/addons', {
        bodyLimit: 1024 * 512,
        config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        const account = await lookupAccountByApiKey(request, reply)
        if (!account) return

        const { addons } = request.body || {}
        if (!Array.isArray(addons)) {
            reply.code(400)
            return { error: 'bad_request', message: 'Request body must contain "addons" array' }
        }
        if (addons.length > MAX_ADDONS_IN_COLLECTION) {
            reply.code(400)
            return { error: 'bad_request', message: `Addon collection exceeds maximum size (${MAX_ADDONS_IN_COLLECTION})` }
        }

        for (const a of addons) {
            const url = a?.transportUrl || a?.url
            if (!url || !isValidAddonUrl(url)) {
                reply.code(400)
                return { error: 'bad_request', message: `Invalid addon URL: ${String(url).slice(0, 100)}` }
            }
        }

        try {
            // Catastrophic-shrink guard (belt-and-suspenders; the client merge's
            // "inbound deletes don't shrink" policy is the real protection and self-heals
            // a bad replace on the next sync). Reject only the obvious wipe: clearing a
            // non-trivial collection to empty, never a legitimate few-addon removal.
            if (addons.length === 0) {
                const current = await getCanonicalAddons(account.account_id, account.sync_user)
                if (current.length >= 3) {
                    reply.code(409)
                    return { error: 'conflict', message: 'Refusing to clear a non-empty addon collection. Remove addons individually.' }
                }
            }

            const normalized = addons.map(a => ({
                transportUrl: a.transportUrl || a.url,
                manifest: {
                    id: a.id || '',
                    name: a.name || '',
                    version: a.version || '',
                    logo: a.logo || '',
                    types: a.types || [],
                    resources: a.resources || []
                },
                enabled: a.enabled !== false
            }))
            await writeCanonicalAddons(account, normalized)
            return { addons: normalized.map(toHydraAddon).filter(Boolean) }
        } catch {
            reply.code(500)
            return { error: 'internal_error', message: 'Failed to replace addon collection' }
        }
    })

    fastify.get('/hydra/addons/:url/health', {
        config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        const account = await lookupAccountByApiKey(request, reply)
        if (!account) return

        const rawUrl = decodeURIComponent(request.params.url)
        if (!isValidAddonUrl(rawUrl) || !(await isSafeUrlResolved(rawUrl))) {
            reply.code(400)
            return { error: 'bad_request', message: 'Invalid or unsafe addon URL' }
        }

        try {
            const start = Date.now()
            const res = await enqueueProxyRequest(rawUrl, () => fetch(rawUrl, {
                signal: AbortSignal.timeout(8000)
            }))
            const latencyMs = Date.now() - start
            return { healthy: res.ok, latencyMs }
        } catch {
            return { healthy: false, latencyMs: -1 }
        }
    })

    fastify.post('/hydra/reinstall', {
        bodyLimit: 1024 * 100,
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        const account = await lookupAccountByApiKey(request, reply)
        if (!account) return

        const { addonUrl, addonId } = request.body || {}
        if (!addonUrl && !addonId) {
            reply.code(400)
            return { error: 'bad_request', message: 'Must provide addonUrl or addonId' }
        }
        if (addonUrl && !isValidAddonUrl(addonUrl)) {
            reply.code(400)
            return { error: 'bad_request', message: 'Invalid addon URL' }
        }

        try {
            const current = await getCanonicalAddons(account.account_id, account.sync_user)

            let fetchUrl = addonUrl
            if (!fetchUrl) {
                const existing = current.find(a => (a.manifest?.id || a.id) === addonId)
                if (!existing) {
                    reply.code(404)
                    return { error: 'not_found', message: 'Addon not installed; provide addonUrl to install it' }
                }
                fetchUrl = existing.transportUrl || existing.url
            }

            const { valid, manifest } = await validateManifest(fetchUrl)
            if (!valid) {
                reply.code(400)
                return { error: 'bad_request', message: 'Failed to fetch valid manifest from URL' }
            }

            const target = normalizeAddonUrl(fetchUrl)
            const matchIdx = current.findIndex(a => normalizeAddonUrl(a.transportUrl || a.url || '') === target)

            let updated
            if (matchIdx >= 0) {
                updated = current.slice()
                updated[matchIdx] = {
                    ...current[matchIdx],
                    transportUrl: fetchUrl,
                    manifest,
                    metadata: { ...current[matchIdx].metadata, lastUpdated: Date.now() }
                }
            } else {
                updated = [...current, { transportUrl: fetchUrl, manifest }]
            }

            await writeCanonicalAddons(account, updated)

            if (reconciler) {
                try {
                    const connections = await reconciler.resolveConnections(account.account_id, account.sync_user)
                    const targets = connections.filter(c => c.enabled)
                    if (targets.length > 0) {
                        await reconciler.enforceAccount(account.account_id, targets, updated)
                    }
                } catch (e) {
                    logger.warn({ category: 'Hydra' }, `[${account.account_id}] Cross-platform propagation after reinstall failed: ${e.message}`)
                }
            }

            return { addons: updated.map(toHydraAddon).filter(Boolean) }
        } catch {
            reply.code(500)
            return { error: 'internal_error', message: 'Failed to reinstall addon' }
        }
    })

    fastify.post('/hydra/sync', {
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        const account = await lookupAccountByApiKey(request, reply)
        if (!account) return

        try {
            const current = await getCanonicalAddons(account.account_id, account.sync_user)
            await writeCanonicalAddons(account, current)
            return { synced: true, addonCount: current.length }
        } catch {
            reply.code(500)
            return { error: 'internal_error', message: 'Sync failed' }
        }
    })

    fastify.post('/hydra/validate', {
        bodyLimit: 1024 * 100,
        config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        const account = await lookupAccountByApiKey(request, reply)
        if (!account) return

        const { manifestUrl } = request.body || {}
        if (!manifestUrl || !isValidAddonUrl(manifestUrl)) {
            reply.code(400)
            return { error: 'bad_request', message: 'Invalid or missing manifest URL' }
        }

        try {
            const result = await validateManifest(manifestUrl)
            return result
        } catch {
            reply.code(500)
            return { error: 'internal_error', message: 'Manifest validation failed' }
        }
    })

    fastify.post('/hydra/test', {
        bodyLimit: 1024 * 10,
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        const { baseUrl } = request.body || {}
        if (!baseUrl || typeof baseUrl !== 'string') {
            reply.code(400)
            return { error: 'bad_request', message: 'Missing baseUrl' }
        }

        let parsedUrl
        try {
            parsedUrl = new URL(baseUrl)
            if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') throw new Error()
        } catch {
            reply.code(400)
            return { error: 'bad_request', message: 'Invalid baseUrl' }
        }

        if (!(await isSafeUrlResolved(baseUrl))) {
            reply.code(400)
            return { error: 'bad_request', message: 'Unsafe or private baseUrl' }
        }

        const results = []

        const testEndpoint = async (label, method, path, headers, body) => {
            const start = Date.now()
            try {
                const opts = {
                    method,
                    headers: { 'Content-Type': 'application/json', ...headers },
                    signal: AbortSignal.timeout(10000)
                }
                if (body) opts.body = JSON.stringify(body)
                const res = await fetch(`${parsedUrl.origin}${path}`, opts)
                const elapsed = Date.now() - start
                let resBody
                try { resBody = await res.json() } catch { resBody = null }
                return { endpoint: `${method} ${path}`, status: res.status, latencyMs: elapsed, pass: res.status < 400, details: resBody }
            } catch (e) {
                return { endpoint: `${method} ${path}`, status: 0, latencyMs: Date.now() - start, pass: false, error: e.message }
            }
        }

        results.push(await testEndpoint('GET /hydra/status', 'GET', '/hydra/status'))

        const apiKey = request.headers['x-api-key']
        const authHeaders = apiKey ? { 'X-API-Key': apiKey } : {}
        const testManifestUrl = 'https://example.com/test-hydra-compliance/manifest.json'

        results.push(await testEndpoint('GET /hydra/addons', 'GET', '/hydra/addons', authHeaders))

        results.push(await testEndpoint('POST /hydra/addons', 'POST', '/hydra/addons', authHeaders, { url: testManifestUrl }))

        const encodedUrl = encodeURIComponent(testManifestUrl)
        results.push(await testEndpoint('DELETE /hydra/addons', 'DELETE', `/hydra/addons?url=${encodedUrl}`, authHeaders))

        results.push(await testEndpoint('POST /hydra/reinstall', 'POST', '/hydra/reinstall', authHeaders, { addonUrl: testManifestUrl }))

        results.push(await testEndpoint('POST /hydra/validate', 'POST', '/hydra/validate', authHeaders, { manifestUrl: testManifestUrl }))

        return { results, totalTests: results.length, passed: results.filter(r => r.pass).length }
    })
}
