import crypto from 'crypto'

export function generateApiKey() {
    return crypto.randomUUID()
}

export function hashApiKey(key) {
    return crypto.createHash('sha256').update(key).digest('hex')
}

export function verifyApiKey(key, hash) {
    const computed = hashApiKey(key)
    if (computed.length !== hash.length) return false
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(hash))
}
