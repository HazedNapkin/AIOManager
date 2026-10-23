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

async function persistRotatedToken(connectionId, credentialType, newBundle, accountId, syncUser, previousBundle) {
    if (!accountId || !syncUser) {
        throw new Error(`Refusing unscoped persist of rotated ${credentialType} token for ${connectionId}: account and owner are both required`)
    }
    let lastErr = null
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const row = await db.get(
                'SELECT auth_key FROM server_credentials WHERE connection_id = $1 AND credential_type = $2 AND account_id = $3 AND sync_user = $4 ORDER BY updated_at DESC LIMIT 1',
                [connectionId, credentialType, accountId, syncUser]
            )
            const latest = row?.auth_key ? JSON.parse(decrypt(row.auth_key, FALLBACK_KEYS)) : null
            const tokenField = credentialType === 'nuvio' ? 'refreshToken' : 'accessToken'
            if (!latest || latest[tokenField] !== previousBundle[tokenField] || latest.baseUrl !== previousBundle.baseUrl) {
                const err = new Error('Connection credentials changed during token refresh')
                err._credentialSuperseded = true
                throw err
            }
            // Preserve concurrent profile edits; replace only fields this operation changed.
            const updated = { ...latest, ...Object.fromEntries(Object.entries(newBundle).filter(([key, value]) => value !== previousBundle[key])) }
            const encrypted = encrypt(JSON.stringify(updated), PRIMARY_KEY)
            const result = await db.run(
                'UPDATE server_credentials SET auth_key = $1, updated_at = $2 WHERE connection_id = $3 AND credential_type = $4 AND account_id = $5 AND sync_user = $6 AND auth_key = $7',
                [encrypted, Date.now(), connectionId, credentialType, accountId, syncUser, row.auth_key]
            )
            if (result.changes === 0) throw new Error('Connection credential changed before persistence')
            const { invalidateConnectionCache } = await import('./reconciler.js')
            invalidateConnectionCache(syncUser)
            return updated
        } catch (err) {
            if (err._credentialSuperseded) throw err
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
    return singleFlight(JSON.stringify(['nuvio', connectionId, accountId ?? null, syncUser ?? null]), () => refreshNuvioTokenInner(connectionId, accountId, heal, syncUser))
}

async function refreshNuvioTokenInner(connectionId, accountId, heal, syncUser) {
    const start = Date.now()
    trace('tokenRefresh', 'nuvio.start', { connectionId, accountId })
    // Connection IDs alone do not authorize credential access.
    if (!syncUser || !accountId) {
        trace('tokenRefresh', 'nuvio.skip', { connectionId, accountId, reason: syncUser ? 'no-account' : 'no-owner' })
        return null
    }
    const cred = await db.get(
        "SELECT auth_key FROM server_credentials WHERE connection_id = $1 AND credential_type = 'nuvio' AND sync_user = $2 AND account_id = $3 ORDER BY updated_at DESC LIMIT 1",
        [connectionId, syncUser, accountId]
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
    if (!bundle || typeof bundle !== 'object') {
        trace('tokenRefresh', 'nuvio.skip', { connectionId, accountId, reason: 'unreadable-bundle' })
        return null
    }

    // A bundle without baseUrl pushes to the public api.nuvio.tv; persist the heal before
    // refreshing so the refresh itself targets the client's real backend.
    if (heal?.baseUrl && !bundle.baseUrl) {
        const healed = { ...bundle, baseUrl: heal.baseUrl }
        if (heal.publishableKey && !bundle.publishableKey) healed.publishableKey = heal.publishableKey
        bundle = await persistRotatedToken(connectionId, 'nuvio', healed, accountId, syncUser, bundle)
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
            ...bundle,
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken || bundle.refreshToken,
            expiresAt: refreshed.expiresAt,
        }

        const persisted = await persistRotatedToken(connectionId, 'nuvio', newBundle, accountId, syncUser, bundle)
        trace('tokenRefresh', 'nuvio.success', { connectionId, accountId, timing: Date.now() - start })
        return persisted
    } catch (err) {
        if (err.isAuthError) {
            err._authExpired = true
        }
        trace('tokenRefresh', 'nuvio.error', { connectionId, accountId, isAuthError: !!err.isAuthError, error: err.message, timing: Date.now() - start })
        throw err
    }
}

export function refreshRealStreamToken(connectionId, accountId, syncUser) {
    return singleFlight(JSON.stringify(['realstream', connectionId, accountId ?? null, syncUser ?? null]), () => refreshRealStreamTokenInner(connectionId, accountId, syncUser))
}

async function refreshRealStreamTokenInner(connectionId, accountId, syncUser) {
    const start = Date.now()
    trace('tokenRefresh', 'realstream.start', { connectionId, accountId })
    // Fail closed exactly like the nuvio path: no owner+account scope, no credential access.
    if (!syncUser || !accountId) {
        trace('tokenRefresh', 'realstream.skip', { connectionId, accountId, reason: syncUser ? 'no-account' : 'no-owner' })
        return null
    }
    const cred = await db.get(
        "SELECT auth_key FROM server_credentials WHERE connection_id = $1 AND credential_type = 'realstream' AND sync_user = $2 AND account_id = $3 ORDER BY updated_at DESC LIMIT 1",
        [connectionId, syncUser, accountId]
    )
    if (!cred?.auth_key) {
        trace('tokenRefresh', 'realstream.skip', { connectionId, accountId, reason: 'no-credential' })
        return null
    }

    let bundle
    try {
        bundle = JSON.parse(decrypt(cred.auth_key, FALLBACK_KEYS))
    } catch {
        trace('tokenRefresh', 'realstream.skip', { connectionId, reason: 'decrypt-failed' })
        return null
    }
    if (!bundle || typeof bundle !== 'object') {
        trace('tokenRefresh', 'realstream.skip', { connectionId, accountId, reason: 'unreadable-bundle' })
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
            ...bundle,
            accessToken: refreshed.accessToken,
            userId: refreshed.userId || bundle.userId,
            expiresAt: refreshed.expiresAt,
        }
        const persisted = await persistRotatedToken(connectionId, 'realstream', newBundle, accountId, syncUser, bundle)
        trace('tokenRefresh', 'realstream.success', { connectionId, path: 'refresh', timing: Date.now() - start })
        return persisted
    } catch (err) {
        if (!err.isAuthError) {
            trace('tokenRefresh', 'realstream.error', { connectionId, isAuthError: false, error: err.message, timing: Date.now() - start })
            throw err
        }

        if (bundle.email && bundle.password) {
            try {
                const reauthed = await driver.authenticate(bundle.email, bundle.password)
                const newBundle = {
                    ...bundle,
                    accessToken: reauthed.accessToken,
                    userId: reauthed.userId || bundle.userId,
                    expiresAt: reauthed.expiresAt,
                }
                const persisted = await persistRotatedToken(connectionId, 'realstream', newBundle, accountId, syncUser, bundle)
                trace('tokenRefresh', 'realstream.success', { connectionId, path: 'reauth', timing: Date.now() - start })
                return persisted
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
