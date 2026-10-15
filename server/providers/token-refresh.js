import db from '../db.js'
import { decrypt, encrypt } from '../crypto.js'
import { FALLBACK_KEYS, PRIMARY_KEY } from '../keys.js'
import { trace } from '../utils/trace.js'

export const REFRESH_BUFFER_MS = 5 * 60 * 1000

const refreshInFlight = new Map()
function singleFlight(key, fn) {
    const existing = refreshInFlight.get(key)
    if (existing) return existing
    const p = Promise.resolve().then(fn).finally(() => refreshInFlight.delete(key))
    refreshInFlight.set(key, p)
    return p
}

async function persistRotatedToken(connectionId, credentialType, newBundle, syncUser) {
    const encrypted = encrypt(JSON.stringify(newBundle), PRIMARY_KEY)
    const now = Date.now()
    let lastErr = null
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            await db.run(
                syncUser
                    ? 'UPDATE server_credentials SET auth_key = $1, updated_at = $2 WHERE connection_id = $3 AND credential_type = $4 AND sync_user = $5'
                    : 'UPDATE server_credentials SET auth_key = $1, updated_at = $2 WHERE connection_id = $3 AND credential_type = $4',
                syncUser ? [encrypted, now, connectionId, credentialType, syncUser] : [encrypted, now, connectionId, credentialType]
            )
            const { invalidateConnectionCache } = await import('./reconciler.js')
            invalidateConnectionCache(syncUser)
            return
        } catch (err) {
            lastErr = err
            await new Promise(r => setTimeout(r, 150 * (attempt + 1)))
        }
    }
    console.error(`[TokenRefresh] CRITICAL: rotated ${credentialType} token for ${connectionId} could not be persisted; connection will brick. ${lastErr?.message || lastErr}`)
    const e = new Error(`Failed to persist rotated ${credentialType} token for ${connectionId}: ${lastErr?.message || lastErr}`)
    e._tokenPersistFailed = true
    throw e
}

export function refreshNuvioToken(connectionId, accountId, heal, syncUser) {
    return singleFlight(JSON.stringify(['nuvio', connectionId, syncUser ?? null]), () => refreshNuvioTokenInner(connectionId, accountId, heal, syncUser))
}

async function refreshNuvioTokenInner(connectionId, accountId, heal, syncUser) {
    const start = Date.now()
    trace('tokenRefresh', 'nuvio.start', { connectionId, accountId })
    const cred = await db.get(
        syncUser
            ? "SELECT auth_key FROM server_credentials WHERE connection_id = $1 AND credential_type = 'nuvio' AND sync_user = $2 ORDER BY updated_at DESC LIMIT 1"
            : "SELECT auth_key FROM server_credentials WHERE connection_id = $1 AND credential_type = 'nuvio' LIMIT 1",
        syncUser ? [connectionId, syncUser] : [connectionId]
    )
    if (!cred?.auth_key) {
        trace('tokenRefresh', 'nuvio.skip', { connectionId, accountId, reason: 'no-credential' })
        return null
    }

    let bundle
    try {
        bundle = JSON.parse(decrypt(cred.auth_key, FALLBACK_KEYS))
    } catch {
        trace('tokenRefresh', 'nuvio.skip', { connectionId, accountId, reason: 'decrypt-failed' })
        return null
    }

    // A bundle without baseUrl pushes to the public api.nuvio.tv; persist the heal before
    // refreshing so the refresh itself targets the client's real backend.
    if (heal?.baseUrl && !bundle.baseUrl) {
        bundle.baseUrl = heal.baseUrl
        if (heal.publishableKey && !bundle.publishableKey) bundle.publishableKey = heal.publishableKey
        await persistRotatedToken(connectionId, 'nuvio', bundle, syncUser)
        trace('tokenRefresh', 'nuvio.baseUrlHealed', { connectionId, accountId })
    }

    if (!bundle.refreshToken) {
        trace('tokenRefresh', 'nuvio.skip', { connectionId, accountId, reason: 'no-refresh-token' })
        return null
    }

    if (bundle.expiresAt && bundle.expiresAt - Date.now() > REFRESH_BUFFER_MS) {
        trace('tokenRefresh', 'nuvio.skip', { connectionId, accountId, reason: 'not-expiring' })
        return bundle
    }

    const { createNuvioDriver } = await import('./nuvio-driver.js')
    const driver = createNuvioDriver({
        baseUrl: bundle.baseUrl || undefined,
        publishableKey: bundle.publishableKey || undefined,
    })

    try {
        const refreshed = await driver.refreshAccessToken(bundle.refreshToken)
        const newBundle = {
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken || bundle.refreshToken,
            expiresAt: refreshed.expiresAt,
            profileId: bundle.profileId || null,
            baseUrl: bundle.baseUrl || null,
            publishableKey: bundle.publishableKey || null,
        }

        await persistRotatedToken(connectionId, 'nuvio', newBundle, syncUser)
        trace('tokenRefresh', 'nuvio.success', { connectionId, accountId, timing: Date.now() - start })
        return newBundle
    } catch (err) {
        if (err.isAuthError) {
            err._authExpired = true
        }
        trace('tokenRefresh', 'nuvio.error', { connectionId, accountId, isAuthError: !!err.isAuthError, error: err.message, timing: Date.now() - start })
        throw err
    }
}

export function refreshRealStreamToken(connectionId, syncUser) {
    return singleFlight(JSON.stringify(['realstream', connectionId, syncUser ?? null]), () => refreshRealStreamTokenInner(connectionId, syncUser))
}

async function refreshRealStreamTokenInner(connectionId, syncUser) {
    const start = Date.now()
    trace('tokenRefresh', 'realstream.start', { connectionId })
    const cred = await db.get(
        syncUser
            ? "SELECT auth_key FROM server_credentials WHERE connection_id = $1 AND credential_type = 'realstream' AND sync_user = $2 ORDER BY updated_at DESC LIMIT 1"
            : "SELECT auth_key FROM server_credentials WHERE connection_id = $1 AND credential_type = 'realstream' LIMIT 1",
        syncUser ? [connectionId, syncUser] : [connectionId]
    )
    if (!cred?.auth_key) {
        trace('tokenRefresh', 'realstream.skip', { connectionId, reason: 'no-credential' })
        return null
    }

    let bundle
    try {
        bundle = JSON.parse(decrypt(cred.auth_key, FALLBACK_KEYS))
    } catch {
        trace('tokenRefresh', 'realstream.skip', { connectionId, reason: 'decrypt-failed' })
        return null
    }

    if (!bundle.accessToken) {
        trace('tokenRefresh', 'realstream.skip', { connectionId, reason: 'no-access-token' })
        return null
    }

    if (bundle.expiresAt && bundle.expiresAt - Date.now() > REFRESH_BUFFER_MS) {
        trace('tokenRefresh', 'realstream.skip', { connectionId, reason: 'not-expiring' })
        return bundle
    }

    const { createRealStreamDriver } = await import('./realstream-driver.js')
    const driver = createRealStreamDriver(bundle.baseUrl ? { baseUrl: bundle.baseUrl } : {})

    try {
        const refreshed = await driver.refreshAccessToken(bundle.accessToken)
        const newBundle = {
            accessToken: refreshed.accessToken,
            userId: refreshed.userId || bundle.userId,
            expiresAt: refreshed.expiresAt,
            baseUrl: bundle.baseUrl,
            email: bundle.email,
            password: bundle.password,
        }
        await persistRotatedToken(connectionId, 'realstream', newBundle, syncUser)
        trace('tokenRefresh', 'realstream.success', { connectionId, path: 'refresh', timing: Date.now() - start })
        return newBundle
    } catch (err) {
        if (!err.isAuthError) {
            trace('tokenRefresh', 'realstream.error', { connectionId, isAuthError: false, error: err.message, timing: Date.now() - start })
            throw err
        }

        if (bundle.email && bundle.password) {
            try {
                const reauthed = await driver.authenticate(bundle.email, bundle.password)
                const newBundle = {
                    accessToken: reauthed.accessToken,
                    userId: reauthed.userId || bundle.userId,
                    expiresAt: reauthed.expiresAt,
                    baseUrl: bundle.baseUrl,
                    email: bundle.email,
                    password: bundle.password,
                }
                await persistRotatedToken(connectionId, 'realstream', newBundle, syncUser)
                trace('tokenRefresh', 'realstream.success', { connectionId, path: 'reauth', timing: Date.now() - start })
                return newBundle
            } catch (reauthErr) {
                reauthErr._authExpired = true
                trace('tokenRefresh', 'realstream.error', { connectionId, path: 'reauth', error: reauthErr.message, timing: Date.now() - start })
                throw reauthErr
            }
        }

        err._authExpired = true
        trace('tokenRefresh', 'realstream.error', { connectionId, isAuthError: true, error: err.message, timing: Date.now() - start })
        throw err
    }
}
