import { verifyAuth } from '../auth.js'
import db from '../db.js'
import { encrypt, decrypt } from '../crypto.js'
import { PRIMARY_KEY, FALLBACK_KEYS } from '../keys.js'
import { isSafeUrlResolved } from '../utils/ssrf.js'

// An authenticated user "owns" an accountId iff they have a stored credential or canonical row for
// it. Used to reject cross-tenant access (the sync/status endpoints take an accountId from the URL,
// which is otherwise unscoped). Unowned -> the caller has nothing to sync/read, so endpoints return
// the empty success shape rather than a 403 (no account-existence oracle, and it can't break a
// first sync, since an account with no stored credentials has nothing for the server to reconcile).
async function accountBelongsTo(accountId, syncUser) {
    if (!accountId || !syncUser) return false
    const cred = await db.get(
        'SELECT 1 AS ok FROM server_credentials WHERE account_id = $1 AND sync_user = $2 LIMIT 1',
        [accountId, syncUser]
    )
    if (cred) return true
    const canon = await db.get(
        'SELECT 1 AS ok FROM account_canonical_addons WHERE account_id = $1 AND sync_user = $2 LIMIT 1',
        [accountId, syncUser]
    )
    return Boolean(canon)
}

export function registerProviderRoutes(fastify, reconciler) {
    fastify.post('/api/providers/sync/:accountId', {
        config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.code(401); return { error: 'Unauthorized' } }

        const { accountId } = request.params
        const { primaryConnectionId, connections, addons } = request.body || {}

        if (!(await accountBelongsTo(accountId, authUser))) {
            return { synced: true, changes: [], connectionStates: {} }
        }

        try {
            const resolvedConnections = connections || await reconciler.resolveConnections(accountId, authUser)

            if (!resolvedConnections || resolvedConnections.length === 0) {
                return { synced: true, changes: [], connectionStates: {} }
            }

            const result = await reconciler.reconcileAccount(
                accountId,
                primaryConnectionId,
                resolvedConnections,
                addons
            )

            if (result.changes.length > 0) {
                fastify.log.info({ category: 'Reconciler' }, `[${accountId}] Reconciled: ${result.changes.length} changes`)
            }

            for (const conn of resolvedConnections.filter(c => c.platform === 'nuvio')) {
                await reconciler.reconcilePlugins(accountId, conn)
            }

            const states = reconciler.getConnectionStates(accountId)

            return {
                synced: true,
                changes: result.changes,
                connectionStates: states
            }
        } catch (err) {
            fastify.log.error({ category: 'Reconciler' }, `[${accountId}] Sync failed: ${err.message}`)
            reply.code(500)
            return { error: 'Sync failed' }
        }
    })

    fastify.get('/api/providers/status/:accountId', {
        config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.code(401); return { error: 'Unauthorized' } }

        const { accountId } = request.params
        if (!(await accountBelongsTo(accountId, authUser))) {
            return { connectionStates: {} }
        }
        const states = reconciler.getConnectionStates(accountId)
        return { connectionStates: states }
    })

    fastify.get('/api/providers/subscribers/:accountId', {
        config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.code(401); return { error: 'Unauthorized' } }

        const { accountId } = request.params
        const rows = await db.query(
            'SELECT name, logo, created_at, last_seen_at FROM hydra_subscribers WHERE account_id = $1 AND sync_user = $2 ORDER BY last_seen_at DESC',
            [accountId, authUser]
        )
        return { subscribers: rows || [] }
    })

    fastify.delete('/api/providers/subscribers/:accountId', {
        config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.code(401); return { error: 'Unauthorized' } }

        const { accountId } = request.params
        const { name } = request.body || {}
        if (!name) { reply.code(400); return { error: 'Missing name' } }

        await db.run(
            'DELETE FROM hydra_subscribers WHERE account_id = $1 AND sync_user = $2 AND name = $3',
            [accountId, authUser, name]
        )
        return { ok: true }
    })

    fastify.post('/api/providers/connections/:connectionId/credentials', {
        config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.code(401); return { error: 'Unauthorized' } }

        const { connectionId } = request.params
        const { accountId, credential, credentialType } = request.body || {}
        if (!accountId || !credential) { reply.code(400); return { error: 'Missing accountId or credential' } }

        const type = ['nuvio', 'realstream', 'hydra'].includes(credentialType) ? credentialType : 'hydra'
        const credentialValue = typeof credential === 'object' ? JSON.stringify(credential) : credential
        const encrypted = encrypt(credentialValue, PRIMARY_KEY)
        const id = `${type}:${accountId}:${connectionId}`

        // id embeds the per-user accountId UUID, so a row under this id owned by a different user is
        // never a legitimate collision -- it's a cross-tenant write attempt. Without this check the
        // Postgres DO UPDATE would poison the victim's auth_key (sync_user stays theirs, so the
        // scoped resolveConnections still serves it) and the SQLite INSERT OR REPLACE would flip the
        // row to the attacker (silent DoS).
        const existing = await db.get('SELECT sync_user FROM server_credentials WHERE id = $1', [id])
        if (existing && existing.sync_user !== authUser) {
            reply.code(403); return { error: 'Forbidden' }
        }

        if (db.type === 'postgres') {
            await db.run(`
                INSERT INTO server_credentials (id, sync_user, account_id, auth_key, connection_id, credential_type, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (id) DO UPDATE SET auth_key = $4, credential_type = $6, updated_at = $7
            `, [id, authUser, accountId, encrypted, connectionId, type, Date.now()])
        } else {
            await db.run(`
                INSERT OR REPLACE INTO server_credentials (id, sync_user, account_id, auth_key, connection_id, credential_type, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [id, authUser, accountId, encrypted, connectionId, type, Date.now()])
        }

        return { ok: true }
    })

    fastify.delete('/api/providers/connections/:connectionId/credentials', {
        config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.code(401); return { error: 'Unauthorized' } }

        const { connectionId } = request.params
        await db.run(
            'DELETE FROM server_credentials WHERE connection_id = $1 AND sync_user = $2',
            [connectionId, authUser]
        )
        return { ok: true }
    })

    // Vends a fresh Nuvio access token to the client. The server is the single owner of the
    // rotating refresh token (refreshNuvioToken is single-flighted), so client push + failover
    // never double-rotate it.
    fastify.post('/api/providers/connections/:connectionId/token', {
        config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.code(401); return { error: 'Unauthorized' } }

        const { connectionId } = request.params
        const { accountId, platform } = request.body || {}
        if (!accountId || !['nuvio', 'realstream'].includes(platform)) { reply.code(400); return { error: 'Missing accountId or unsupported platform' } }

        if (platform === 'nuvio') {
            try {
                const owned = await db.get(
                    "SELECT 1 FROM server_credentials WHERE connection_id = $1 AND sync_user = $2 AND credential_type = 'nuvio' LIMIT 1",
                    [connectionId, authUser]
                )
                if (!owned) { reply.code(404); return { error: 'Connection not found' } }

                const { refreshNuvioToken } = await import('../providers/token-refresh.js')
                const bundle = await refreshNuvioToken(connectionId, accountId)
                if (!bundle?.accessToken) { reply.code(401); return { error: 'Nuvio session expired, re-authenticate' } }
                return { accessToken: bundle.accessToken, expiresAt: bundle.expiresAt, profileId: bundle.profileId ?? null }
            } catch (err) {
                if (err.isAuthError || err._nuvioRefreshExpired) { reply.code(401); return { error: 'Nuvio session expired, re-authenticate' } }
                fastify.log.error({ err, connectionId, accountId, category: 'ConnectionToken' }, `Nuvio token fetch failed: ${err.message}`)
                reply.code(502); return { error: 'Nuvio token refresh failed' }
            }
        }

        // RealStream: server owns custody — refresh via PocketBase auth-refresh, falling back to
        // full re-authentication using the stored email+password if the token has fully expired.
        try {
            const owned = await db.get(
                "SELECT 1 FROM server_credentials WHERE connection_id = $1 AND sync_user = $2 AND credential_type = 'realstream' LIMIT 1",
                [connectionId, authUser]
            )
            if (!owned) { reply.code(404); return { error: 'Connection not found' } }

            const { refreshRealStreamToken } = await import('../providers/token-refresh.js')
            const bundle = await refreshRealStreamToken(connectionId)
            if (!bundle?.accessToken) { reply.code(401); return { error: 'RealStream session expired, re-authenticate' } }
            return { accessToken: bundle.accessToken, expiresAt: bundle.expiresAt, profileId: null }
        } catch (err) {
            if (err.isAuthError || err._realstreamRefreshExpired) { reply.code(401); return { error: 'RealStream session expired, re-authenticate' } }
            fastify.log.error({ err, connectionId, accountId, category: 'ConnectionToken' }, `RealStream token fetch failed: ${err.message}`)
            reply.code(502); return { error: 'RealStream token refresh failed' }
        }
    })

    // Switches which Nuvio profile a connection syncs to. Updates only profileId in the stored
    // bundle, never the rotating tokens, so a client switch can't clobber a server-rotated token.
    fastify.post('/api/providers/connections/:connectionId/profile', {
        config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.code(401); return { error: 'Unauthorized' } }

        const { connectionId } = request.params
        const { profileId } = request.body || {}
        if (!profileId || typeof profileId !== 'string') { reply.code(400); return { error: 'Missing profileId' } }

        const cred = await db.get(
            "SELECT auth_key FROM server_credentials WHERE connection_id = $1 AND sync_user = $2 AND credential_type = 'nuvio' LIMIT 1",
            [connectionId, authUser]
        )
        if (!cred?.auth_key) { reply.code(404); return { error: 'Connection not found' } }

        let bundle
        try { bundle = JSON.parse(decrypt(cred.auth_key, FALLBACK_KEYS)) } catch { reply.code(500); return { error: 'Could not read connection credential' } }

        bundle.profileId = profileId
        const encrypted = encrypt(JSON.stringify(bundle), PRIMARY_KEY)
        const result = await db.run(
            "UPDATE server_credentials SET auth_key = $1, updated_at = $2 WHERE connection_id = $3 AND sync_user = $4 AND credential_type = 'nuvio' AND auth_key = $5",
            [encrypted, Date.now(), connectionId, authUser, cred.auth_key]
        )
        const rowsAffected = result.changes
        if (rowsAffected === 0) {
            const retry = await db.get(
                "SELECT auth_key FROM server_credentials WHERE connection_id = $1 AND sync_user = $2 AND credential_type = 'nuvio' LIMIT 1",
                [connectionId, authUser]
            )
            if (!retry?.auth_key) { reply.code(404); return { error: 'Connection not found' } }
            let retryBundle
            try { retryBundle = JSON.parse(decrypt(retry.auth_key, FALLBACK_KEYS)) } catch { reply.code(500); return { error: 'Could not read connection credential' } }
            retryBundle.profileId = profileId
            const retryEncrypted = encrypt(JSON.stringify(retryBundle), PRIMARY_KEY)
            await db.run(
                "UPDATE server_credentials SET auth_key = $1, updated_at = $2 WHERE connection_id = $3 AND sync_user = $4 AND credential_type = 'nuvio'",
                [retryEncrypted, Date.now(), connectionId, authUser]
            )
        }
        return { ok: true }
    })

    fastify.post('/api/providers/nuvio/auth', {
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.code(401); return { error: 'Unauthorized' } }

        const { email, password, publishableKey } = request.body || {}
        if (!email || !password) { reply.code(400); return { error: 'Missing email or password' } }

        try {
            const { createNuvioDriver } = await import('../providers/nuvio-driver.js')
            const driver = createNuvioDriver(publishableKey ? { publishableKey } : {})
            const tokens = await driver.authenticate(email, password)
            let profiles = []
            try {
                profiles = await driver.pullProfiles(tokens.accessToken)
            } catch {}
            return { tokens, profiles: Array.isArray(profiles) ? profiles : [] }
        } catch (err) {
            if (err.name === 'TimeoutError' || err.name === 'AbortError') {
                reply.code(504)
                return { error: 'Nuvio login timed out. Supabase may be cold-starting. Please try again in a few seconds.' }
            }
            if (err.status === 429) {
                reply.code(429)
                return { error: 'Too many login attempts. Please wait a few minutes before retrying.' }
            }
            const status = err.isAuthError ? 401 : 502
            reply.code(status)
            return { error: err.isAuthError ? 'Invalid email or password' : 'Nuvio service unreachable' }
        }
    })

    fastify.post('/api/providers/realstream/auth', {
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.code(401); return { error: 'Unauthorized' } }

        const { email, password, baseUrl } = request.body || {}
        if (!email || !password) { reply.code(400); return { error: 'Missing email or password' } }

        if (baseUrl && !(await isSafeUrlResolved(baseUrl))) { reply.code(400); return { error: 'Invalid or unsafe baseUrl' } }

        try {
            const { createRealStreamDriver } = await import('../providers/realstream-driver.js')
            const driver = createRealStreamDriver(baseUrl ? { baseUrl } : {})
            const tokens = await driver.authenticate(email, password)
            // Password is NOT stored. Only the token bundle is returned for handoff.
            return { tokens }
        } catch (err) {
            if (err.name === 'TimeoutError' || err.name === 'AbortError') {
                reply.code(504)
                return { error: 'RealStream login timed out. Please try again in a few seconds.' }
            }
            if (err.status === 429) {
                reply.code(429)
                return { error: 'Too many login attempts. Please wait a few minutes before retrying.' }
            }
            const status = err.isAuthError ? 401 : 502
            reply.code(status)
            return { error: err.isAuthError ? 'Invalid email or password' : 'RealStream service unreachable' }
        }
    })

    fastify.post('/api/providers/nuvio/signup', {
        config: { rateLimit: { max: 5, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.code(401); return { error: 'Unauthorized' } }

        const { email, password, publishableKey } = request.body || {}
        if (!email || !password) { reply.code(400); return { error: 'Missing email or password' } }

        try {
            const { createNuvioDriver } = await import('../providers/nuvio-driver.js')
            const driver = createNuvioDriver(publishableKey ? { publishableKey } : {})
            const tokens = await driver.register(email, password)
            let profiles = []
            try { profiles = await driver.pullProfiles(tokens.accessToken) } catch {}
            return { tokens, profiles: Array.isArray(profiles) ? profiles : [] }
        } catch (err) {
            if (err.needsConfirmation) { reply.code(202); return { error: err.message, needsConfirmation: true } }
            if (err.name === 'TimeoutError' || err.name === 'AbortError') { reply.code(504); return { error: 'Nuvio signup timed out. Please try again.' } }
            if (err.status === 429) { reply.code(429); return { error: 'Too many attempts. Please wait a few minutes.' } }
            const status = err.isAuthError ? 400 : 502
            reply.code(status)
            return { error: err.isAuthError ? (err.message || 'Could not create account') : 'Nuvio service unreachable' }
        }
    })

    fastify.post('/api/providers/realstream/signup', {
        config: { rateLimit: { max: 5, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.code(401); return { error: 'Unauthorized' } }

        const { email, password, name, baseUrl } = request.body || {}
        if (!email || !password) { reply.code(400); return { error: 'Missing email or password' } }
        if (baseUrl && !(await isSafeUrlResolved(baseUrl))) { reply.code(400); return { error: 'Invalid or unsafe baseUrl' } }

        try {
            const { createRealStreamDriver } = await import('../providers/realstream-driver.js')
            const driver = createRealStreamDriver(baseUrl ? { baseUrl } : {})
            const tokens = await driver.register(email, password, name)
            return { tokens }
        } catch (err) {
            if (err.name === 'TimeoutError' || err.name === 'AbortError') { reply.code(504); return { error: 'RealStream signup timed out. Please try again.' } }
            if (err.status === 429) { reply.code(429); return { error: 'Too many attempts. Please wait a few minutes.' } }
            const status = err.isAuthError ? 400 : 502
            reply.code(status)
            return { error: err.isAuthError ? (err.message || 'Could not create account') : 'RealStream service unreachable' }
        }
    })

    fastify.post('/api/providers/hydra/test', {
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.code(401); return { error: 'Unauthorized' } }

        const { baseUrl, authType, authHeader, authValue } = request.body || {}
        if (!baseUrl || typeof baseUrl !== 'string') { reply.code(400); return { error: 'Missing baseUrl' } }

        if (!(await isSafeUrlResolved(baseUrl))) { reply.code(400); return { error: 'Invalid or unsafe URL' } }

        try {
            const { createHydraClient } = await import('../hydra/client.js')
            const client = await createHydraClient({ baseUrl, authType, authHeader, authValue })
            const status = await client.status()
            return status
        } catch (err) {
            reply.code(502)
            return { error: err.message || 'Provider unreachable' }
        }
    })

    // Read the server-readable canonical addon lists this sync user owns, keyed by account.
    // The client uses this to detect + merge external (e.g. AIOStreams) writes into the Hub
    // before pushing, the D2 "client is the single merger" path. Returns `updatedAt` so the
    // client can tell whether the canonical changed since its last push.
    fastify.get('/api/providers/canonical', {
        config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.code(401); return { error: 'Unauthorized' } }

        const rows = await db.query(
            'SELECT account_id, addon_list, updated_at FROM account_canonical_addons WHERE sync_user = $1',
            [authUser]
        )
        const canonical = {}
        for (const row of rows) {
            let addons = []
            if (row.addon_list) {
                const decrypted = decrypt(row.addon_list, FALLBACK_KEYS)
                if (decrypted) {
                    try {
                        const parsed = JSON.parse(decrypted)
                        if (Array.isArray(parsed)) addons = parsed
                    } catch {}
                }
            }
            canonical[row.account_id] = { addons, updatedAt: row.updated_at || 0 }
        }
        return { canonical }
    })
}
