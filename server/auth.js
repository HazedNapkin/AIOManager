import crypto from 'crypto'
import db from './db.js'
import { decrypt } from './crypto.js'
import { FALLBACK_KEYS } from './keys.js'
import { getCachedAuth, setCachedAuth, hashAuthPassword } from './state.js'
import { verifySyncPassword, upgradeLegacyPasswordHash } from './lib/sync-password.js'

export const timingSafeEqual = (a, b) => {
    try {
        if (a == null || b == null) return false
        const aBuf = Buffer.from(String(a), 'utf8')
        const bBuf = Buffer.from(String(b), 'utf8')
        if (aBuf.length !== bBuf.length) {
            return false
        }
        return crypto.timingSafeEqual(aBuf, bBuf)
    } catch {
        return false
    }
}

const DEVICE_ID_MAX_LENGTH = 128
const DEVICE_TOKEN_MAX_LENGTH = 512

// Reason precedence: a valid token decides the failure mode; revocation (explicit
// security action) outranks passive expiry, and both outrank generation drift.
export async function authenticateDeviceCredential(syncUser, deviceId, token, now = Date.now()) {
    if (!syncUser || !deviceId || !token) return { ok: false, reason: 'unknown' }
    if (String(deviceId).length > DEVICE_ID_MAX_LENGTH || String(token).length > DEVICE_TOKEN_MAX_LENGTH) {
        return { ok: false, reason: 'unknown' }
    }
    try {
        const row = await db.get(
            'SELECT id, account_uuid, token_hash, revoked, expires_at, credential_epoch FROM device_credentials WHERE account_uuid = $1 AND device_id = $2',
            [String(syncUser), String(deviceId)]
        )
        if (!row) return { ok: false, reason: 'unknown' }
        if (verifySyncPassword(String(token), row.token_hash) !== true) return { ok: false, reason: 'unknown' }
        if (Number(row.revoked) === 1) return { ok: false, reason: 'revoked' }
        if (Number(row.expires_at) <= now) return { ok: false, reason: 'expired' }
        const account = await db.get('SELECT credential_epoch FROM kv_store WHERE key = $1', [String(syncUser)])
        if (!account) return { ok: false, reason: 'unknown' }
        if (Number(account.credential_epoch) !== Number(row.credential_epoch)) return { ok: false, reason: 'generation' }
        return { ok: true, accountUuid: row.account_uuid, row }
    } catch {
        return { ok: false, reason: 'unknown' }
    }
}

// Device credentials authenticate BEFORE any password check. The token is cached under
// a distinct namespace: a device token in the shared password cache would be accepted
// as the account password by headerless requests within the cache TTL.
export async function deviceAuthHook(request, reply) {
    const deviceId = request.headers['x-sync-device']
    if (!deviceId) return
    const syncUser = request.headers['x-sync-user']
    const presented = request.headers['x-sync-password']
    const outcome = await authenticateDeviceCredential(syncUser, deviceId, presented)
    if (outcome.ok) {
        request.deviceAuth = { accountUuid: outcome.accountUuid }
        setCachedAuth('device:' + syncUser, presented)
        try {
            await db.run('UPDATE device_credentials SET last_used_at = $1 WHERE id = $2', [Date.now(), outcome.row.id])
        } catch { }
        return
    }
    reply.status(401)
    return reply.send({ error: 'Device credential rejected', reason: outcome.reason })
}

export async function verifyAuth(request) {
    if (request.deviceAuth?.accountUuid) return request.deviceAuth.accountUuid
    const syncUser = request.headers['x-sync-user']
    const syncPassword = request.headers['x-sync-password']
    if (!syncUser || !syncPassword) return null
    try {
        const cached = getCachedAuth('sync:' + syncUser)
        if (cached && timingSafeEqual(cached, hashAuthPassword(syncPassword))) return syncUser
        const row = await db.get('SELECT password FROM kv_store WHERE key = $1', [syncUser])
        if (!row?.password) return null
        const verified = verifySyncPassword(syncPassword, row.password)
        let authorized = verified === true
        if (verified === null) {
            const decrypted = decrypt(row.password, FALLBACK_KEYS)
            if (decrypted && timingSafeEqual(decrypted, syncPassword)) {
                authorized = true
                await upgradeLegacyPasswordHash(db, syncUser, syncPassword)
            }
        }
        if (!authorized) return null
        setCachedAuth('sync:' + syncUser, syncPassword)
        return syncUser
    } catch {
        return null
    }
}

export async function requireProxyAuth(request, reply) {
    if (request.deviceAuth?.accountUuid) return null
    const syncUser = request.headers['x-sync-user']
    const syncPassword = request.headers['x-sync-password']
    if (!syncUser || !syncPassword) {
        reply.status(401)
        return { error: 'Authentication required' }
    }
    const cached = getCachedAuth('sync:' + syncUser)
    if (cached && timingSafeEqual(cached, hashAuthPassword(syncPassword))) return null
    try {
        const row = await db.get('SELECT password FROM kv_store WHERE key = $1', [syncUser])
        if (!row) {
            reply.status(401)
            return { error: 'Unauthorized' }
        }
        const verified = verifySyncPassword(syncPassword, row.password)
        let authorized = verified === true
        if (verified === null) {
            const decryptedPassword = decrypt(row.password, FALLBACK_KEYS)
            if (decryptedPassword && timingSafeEqual(decryptedPassword, syncPassword)) {
                authorized = true
                await upgradeLegacyPasswordHash(db, syncUser, syncPassword)
            }
        }
        if (!authorized) {
            reply.status(401)
            return { error: 'Unauthorized' }
        }
        setCachedAuth('sync:' + syncUser, syncPassword)
    } catch {
        reply.status(401)
        return { error: 'Unauthorized' }
    }
    return null
}
