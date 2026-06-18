import db from '../db.js'
import { decrypt, encrypt } from '../crypto.js'
import { FALLBACK_KEYS, PRIMARY_KEY } from '../keys.js'

const REFRESH_BUFFER_MS = 5 * 60 * 1000

// Single source of refresh per connection. Supabase rotates the refresh token and revokes the
// whole family if a rotated token is reused, so concurrent refreshers (failover + route + plugin
// reconcile) must share one in-flight call.
const refreshInFlight = new Map()
function singleFlight(key, fn) {
    const existing = refreshInFlight.get(key)
    if (existing) return existing
    const p = Promise.resolve().then(fn).finally(() => refreshInFlight.delete(key))
    refreshInFlight.set(key, p)
    return p
}

// The provider rotates AND revokes the old refresh token on a successful refresh, so the rotated
// token is the only valid one the instant the network call returns. If we then fail to persist it,
// the connection is bricked next cycle (the DB still holds the dead token). Treat the write as
// must-succeed: retry a few times, and if it still fails, throw loudly rather than dropping it.
async function persistRotatedToken(connectionId, credentialType, newBundle) {
    const encrypted = encrypt(JSON.stringify(newBundle), PRIMARY_KEY)
    const now = Date.now()
    let lastErr = null
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            await db.run(
                'UPDATE server_credentials SET auth_key = $1, updated_at = $2 WHERE connection_id = $3 AND credential_type = $4',
                [encrypted, now, connectionId, credentialType]
            )
            return
        } catch (err) {
            lastErr = err
            await new Promise(r => setTimeout(r, 150 * (attempt + 1)))
        }
    }
    // Log here too: the reconciler's loadDriver catch only rethrows auth errors and would otherwise
    // swallow this silently, leaving the connection bricked with no trace.
    console.error(`[TokenRefresh] CRITICAL: rotated ${credentialType} token for ${connectionId} could not be persisted; connection will brick. ${lastErr?.message || lastErr}`)
    const e = new Error(`Failed to persist rotated ${credentialType} token for ${connectionId}: ${lastErr?.message || lastErr}`)
    e._tokenPersistFailed = true
    throw e
}

export function refreshNuvioToken(connectionId, accountId) {
    return singleFlight(`nuvio:${connectionId}`, () => refreshNuvioTokenInner(connectionId, accountId))
}

async function refreshNuvioTokenInner(connectionId, accountId) {
    const cred = await db.get(
        "SELECT auth_key FROM server_credentials WHERE connection_id = $1 AND credential_type = 'nuvio' LIMIT 1",
        [connectionId]
    )
    if (!cred?.auth_key) return null

    let bundle
    try {
        bundle = JSON.parse(decrypt(cred.auth_key, FALLBACK_KEYS))
    } catch {
        return null
    }

    if (!bundle.refreshToken) return null

    if (bundle.expiresAt && bundle.expiresAt - Date.now() > REFRESH_BUFFER_MS) {
        return bundle
    }

    const { createNuvioDriver } = await import('./nuvio-driver.js')
    const driver = createNuvioDriver()

    try {
        const refreshed = await driver.refreshAccessToken(bundle.refreshToken)
        const newBundle = {
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken || bundle.refreshToken,
            expiresAt: refreshed.expiresAt,
            profileId: bundle.profileId || null,
        }

        await persistRotatedToken(connectionId, 'nuvio', newBundle)
        return newBundle
    } catch (err) {
        if (err.isAuthError) {
            err._authExpired = true
        }
        throw err
    }
}

// RealStream (PocketBase) bundle: { accessToken, userId, expiresAt }. There is no separate
// refresh token; auth-refresh extends the still-valid access token, so a 401/403 means the
// user must re-authenticate.
export function refreshRealStreamToken(connectionId) {
    return singleFlight(`realstream:${connectionId}`, () => refreshRealStreamTokenInner(connectionId))
}

async function refreshRealStreamTokenInner(connectionId) {
    const cred = await db.get(
        "SELECT auth_key FROM server_credentials WHERE connection_id = $1 AND credential_type = 'realstream' LIMIT 1",
        [connectionId]
    )
    if (!cred?.auth_key) return null

    let bundle
    try {
        bundle = JSON.parse(decrypt(cred.auth_key, FALLBACK_KEYS))
    } catch {
        return null
    }

    if (!bundle.accessToken) return null

    if (bundle.expiresAt && bundle.expiresAt - Date.now() > REFRESH_BUFFER_MS) {
        return bundle
    }

    // Use the connection's own base (custom instances like rsaccz.com differ from the default),
    // not the hardcoded default, or the refresh hits the wrong PocketBase server and 401s.
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
        await persistRotatedToken(connectionId, 'realstream', newBundle)
        return newBundle
    } catch (err) {
        if (!err.isAuthError) throw err

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
                await persistRotatedToken(connectionId, 'realstream', newBundle)
                return newBundle
            } catch (reauthErr) {
                reauthErr._authExpired = true
                throw reauthErr
            }
        }

        err._authExpired = true
        throw err
    }
}
