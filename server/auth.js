import crypto from 'crypto'
import db from './db.js'
import { decrypt } from './crypto.js'
import { FALLBACK_KEYS } from './keys.js'
import { getCachedAuth, setCachedAuth, hashAuthPassword } from './state.js'

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

export async function verifyAuth(request) {
    const syncUser = request.headers['x-sync-user']
    const syncPassword = request.headers['x-sync-password']
    if (!syncUser || !syncPassword) return null
    try {
        const cached = getCachedAuth('sync:' + syncUser)
        if (cached && timingSafeEqual(cached, hashAuthPassword(syncPassword))) return syncUser
        const row = await db.get('SELECT password FROM kv_store WHERE key = $1', [syncUser])
        if (!row?.password) return null
        const decrypted = decrypt(row.password, FALLBACK_KEYS)
        if (!decrypted || !timingSafeEqual(decrypted, syncPassword)) return null
        setCachedAuth('sync:' + syncUser, syncPassword)
        return syncUser
    } catch {
        return null
    }
}

export async function requireProxyAuth(request, reply) {
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
        const decryptedPassword = decrypt(row.password, FALLBACK_KEYS)
        if (!decryptedPassword || !timingSafeEqual(decryptedPassword, syncPassword)) {
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
