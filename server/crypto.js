import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16

const _keyCache = new Map()

function deriveKey(secret) {
    const cached = _keyCache.get(secret)
    if (cached) return cached
    if (_keyCache.size > 100) {
        const evictCount = Math.ceil(_keyCache.size * 0.25)
        let evicted = 0
        for (const key of _keyCache.keys()) {
            if (evicted >= evictCount) break
            _keyCache.delete(key)
            evicted++
        }
    }
    const key = crypto.createHash('sha256').update(String(secret)).digest()
    _keyCache.set(secret, key)
    return key
}

export function encrypt(text, secret) {
    if (!secret) throw new Error('Encryption secret is required')
    if (text === null || text === undefined) return null

    const key = deriveKey(secret)
    const iv = crypto.randomBytes(IV_LENGTH)
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv)

    let encrypted = cipher.update(text, 'utf8', 'base64')
    encrypted += cipher.final('base64')

    const authTag = cipher.getAuthTag().toString('base64')

    return `${iv.toString('base64')}:${encrypted}:${authTag}`
}

export function decrypt(encryptedData, secrets) {
    if (!secrets) throw new Error('Encryption secret is required')

    if (!encryptedData || typeof encryptedData !== 'string' || !encryptedData.includes(':')) return encryptedData

    const parts = encryptedData.split(':')
    if (parts.length !== 3) return encryptedData

    const candidates = Array.isArray(secrets) ? secrets : [secrets]

    for (const secret of candidates) {
        try {
            const [ivBase64, ciphertextBase64, authTagBase64] = parts
            if (!ivBase64 || !ciphertextBase64 || !authTagBase64) continue

            const key = deriveKey(secret)
            const iv = Buffer.from(ivBase64, 'base64')
            const ciphertext = Buffer.from(ciphertextBase64, 'base64')
            const authTag = Buffer.from(authTagBase64, 'base64')

            const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
            decipher.setAuthTag(authTag)

            let decrypted = decipher.update(ciphertext, 'base64', 'utf8')
            decrypted += decipher.final('utf8')

            return decrypted
        } catch (err) {
            continue
        }
    }

    console.warn('[Crypto] Decryption failed for all candidate keys. Data may be corrupted or key lost.')
    return null
}

export function generateRandomKey() {
    return crypto.randomBytes(32).toString('hex')
}
