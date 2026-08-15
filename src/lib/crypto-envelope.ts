// Versioned crypto envelope for cloud-sync payloads (Bold Idea 6 pilot).
//
// v2 format: 'v2.' + base64url(salt16) + '.' + base64url(iv12) + '.' + base64url(ciphertext+tag)
//   - AES-256-GCM via WebCrypto (crypto.subtle), key = PBKDF2-SHA256(password, salt, 600000, 256-bit)
//   - Self-contained: salt and IV travel inside the string. The legacy formats relied on a
//     fixed default salt ('aiomanager-sync-key-v2') or a per-account salt stored beside the
//     blob in the cloud record; v2 needs nothing external, so the sync blob stays opaque to
//     the server in the strongest sense (not even a salt hint).
//
// Dual read: decryptEnvelope accepts v2 envelopes AND both legacy sync blob shapes —
//   (a) the current WebCrypto shape, base64(iv || ciphertext+tag), when it was minted with
//       the default fixed salt (i.e. encryptSyncPayload(plaintext, password) with no salt);
//   (b) crypto-js OpenSSL-style blobs ('U2FsdGVkX1...').
// Legacy GCM blobs minted with a per-account syncSalt are NOT self-contained; callers that
// hold that salt should keep using decryptSyncPayload in crypto.ts until the syncStore
// migration. encryptEnvelope always writes v2, so payloads migrate on their next write.
//
// Derivation notes:
//   - Key semantics deliberately match crypto.ts deriveSyncEncryptionKey (PBKDF2-SHA256,
//     600000 iterations, 256-bit AES-GCM key). Iterations are pinned to the v2 format:
//     changing them would break every stored envelope, so a change means minting a v3.
//   - crypto.ts offloads PBKDF2 to a worker to keep login-path UI responsive. This module
//     calls crypto.subtle.deriveKey directly on the calling thread: it is the same native
//     primitive the worker (and its fallback path) ultimately calls, envelope ops are
//     one-shot async sync operations rather than interactive login flows, and keeping this
//     module free of '@/' value imports lets it run under `node --test` (Node does not
//     resolve Vite aliases, and crypto.ts's trace import would break test imports).
//
// Requires a secure context: crypto.subtle is undefined on insecure origins. The app already
// enforces this (see the secure-context warning in LoginPage and the README's "Secure
// Context (HTTPS) Required" section); no additional handling is needed here.

const ENVELOPE_VERSION = 'v2'
const PBKDF2_ITERATIONS = 600000 // matches crypto.ts PBKDF2_ITERATIONS; pinned to the v2 format
const SALT_LENGTH = 16
const IV_LENGTH = 12
const KEY_LENGTH = 256

// Must match crypto.ts SYNC_KEY_SALT: legacy default-salt GCM blobs derived their key
// from this fixed byte string. Coupling is intentional and covered by the tests.
const LEGACY_DEFAULT_SALT = new TextEncoder().encode('aiomanager-sync-key-v2')

const V2_ENVELOPE = /^v2\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/

/**
 * Discriminate v2 envelopes from legacy sync blobs.
 *
 * Unambiguous by construction: both legacy shapes are base64 alphabets (A-Za-z0-9+/= or
 * crypto-js 'U2FsdGVkX1...') and can never contain the '.' separators, while every v2
 * envelope is exactly four dot-separated base64url segments with the 'v2' version tag.
 */
export function isV2Envelope(s: string): boolean {
    return typeof s === 'string' && V2_ENVELOPE.test(s)
}

/**
 * Encrypt a plaintext into a self-contained v2 envelope: 'v2.<salt>.<iv>.<ciphertext>'.
 * Always writes v2. Throws if WebCrypto is unavailable (insecure context).
 */
export async function encryptEnvelope(plaintext: string, password: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
    const key = await deriveKey(String(password), salt)
    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        new TextEncoder().encode(String(plaintext))
    )
    return [
        ENVELOPE_VERSION,
        toBase64Url(salt),
        toBase64Url(iv),
        toBase64Url(new Uint8Array(ciphertext)),
    ].join('.')
}

/**
 * Decrypt a v2 envelope or a legacy sync blob (dual read; see module header for the exact
 * legacy shapes covered). Throws on wrong password, tampering, or malformed input.
 */
export async function decryptEnvelope(envelope: string, password: string): Promise<string> {
    if (!envelope) throw new Error('Envelope is empty')
    if (isV2Envelope(envelope)) return decryptV2(envelope, password)
    return decryptLegacy(envelope, password)
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(password),
        'PBKDF2',
        false,
        ['deriveKey']
    )
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: KEY_LENGTH },
        false,
        ['encrypt', 'decrypt']
    )
}

async function decryptV2(envelope: string, password: string): Promise<string> {
    const parts = envelope.split('.')
    const salt = fromBase64Url(parts[1])
    const iv = fromBase64Url(parts[2])
    if (salt.length !== SALT_LENGTH) {
        throw new Error(`Malformed v2 envelope: expected ${SALT_LENGTH}-byte salt, got ${salt.length}`)
    }
    if (iv.length !== IV_LENGTH) {
        throw new Error(`Malformed v2 envelope: expected ${IV_LENGTH}-byte IV, got ${iv.length}`)
    }
    const key = await deriveKey(password, salt)
    try {
        const plaintext = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv as BufferSource },
            key,
            fromBase64Url(parts[3]) as BufferSource
        )
        return new TextDecoder().decode(plaintext)
    } catch (err) {
        throw new Error('v2 envelope decryption failed: wrong password or corrupted data', { cause: err })
    }
}

// Mirrors crypto.ts decryptSyncPayload(ciphertext, password) with no salt: try the current
// WebCrypto shape (base64(iv || ciphertext+tag) under the default fixed salt), then fall
// back to crypto-js OpenSSL-style blobs ('U2FsdGVkX1...').
async function decryptLegacy(blob: string, password: string): Promise<string> {
    try {
        const combined = Uint8Array.from(atob(blob), (c) => c.charCodeAt(0))
        if (combined.length <= IV_LENGTH) throw new Error('Too short for a legacy GCM blob')
        const key = await deriveKey(password, LEGACY_DEFAULT_SALT)
        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: combined.slice(0, IV_LENGTH) as BufferSource },
            key,
            combined.slice(IV_LENGTH) as BufferSource
        )
        return new TextDecoder().decode(decrypted)
    } catch {
        // crypto-js is CommonJS: Node exposes it only as `.default`, Vite's pre-bundle
        // exposes named exports. Accept both shapes.
        const imported = await import('crypto-js')
        const cryptoJs = imported.AES ? imported : imported.default
        // Wrong password makes crypto-js either return empty or throw 'Malformed UTF-8
        // data'; normalise both into the single failure below.
        let decrypted = ''
        try {
            decrypted = cryptoJs.AES.decrypt(blob, String(password)).toString(cryptoJs.enc.Utf8)
        } catch {
            decrypted = ''
        }
        if (!decrypted) {
            throw new Error(
                'Legacy envelope decryption failed: wrong password, corrupted data, or a per-account-salt blob (needs decryptSyncPayload)'
            )
        }
        return decrypted
    }
}

function toBase64Url(bytes: Uint8Array): string {
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(part: string): Uint8Array {
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
}
