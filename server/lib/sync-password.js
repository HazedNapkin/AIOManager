import crypto from 'crypto'

// Stored format is `${saltHex}:${scryptHex}`. Scrypt params must never change:
// verification recomputes the hash, so a param change orphans every stored row.
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 }
const SCRYPT_HASH_RE = /^[0-9a-f]{32}:[0-9a-f]{64}$/

export function hashSyncPassword(password) {
    const salt = crypto.randomBytes(16)
    const hash = crypto.scryptSync(String(password), salt, 32, SCRYPT_PARAMS).toString('hex')
    return `${salt.toString('hex')}:${hash}`
}

export function isScryptHash(stored) {
    return typeof stored === 'string' && SCRYPT_HASH_RE.test(stored)
}

// Returns true/false for scrypt-formatted stored values, or null when the stored
// value is not a scrypt hash, signaling the caller to fall back to the legacy
// decrypt-and-compare path.
export function verifySyncPassword(password, stored) {
    if (!isScryptHash(stored)) return null
    const [saltHex, hashHex] = stored.split(':')
    const computed = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), 32, SCRYPT_PARAMS).toString('hex')
    const computedBuf = Buffer.from(computed, 'utf8')
    const storedBuf = Buffer.from(hashHex, 'utf8')
    return computedBuf.length === storedBuf.length && crypto.timingSafeEqual(computedBuf, storedBuf)
}

// Opportunistic upgrade after a successful legacy auth. Never throws: a failed
// upgrade must not fail the enclosing request; the next successful auth retries.
export async function upgradeLegacyPasswordHash(runner, id, password) {
    try {
        await runner.run('UPDATE kv_store SET password = $1 WHERE key = $2', [hashSyncPassword(password), id])
    } catch (err) {
        console.warn(`[SyncPassword] Legacy password hash upgrade failed for ${id}: ${err?.message}`)
    }
}
