import type { Connection } from '../../types/connection.ts'

// One sealed value keeps the private configuration URL and token together.
export interface JellyfinSecret {
    baseUrl: string
    accessToken: string
    deviceId: string
    userId: string
}

type Cipher = (value: string) => Promise<string>

export const MEDIA_SIGN_IN_REQUIRED = 'Sign in again to restore this media connection'

export function parseJellyfinSecret(value: string): JellyfinSecret {
    let raw: Partial<JellyfinSecret>
    try { raw = JSON.parse(value) } catch { throw new Error('Invalid media connection credentials') }
    if (!raw || typeof raw !== 'object' || !['baseUrl', 'accessToken', 'deviceId', 'userId'].every(k => typeof raw[k as keyof JellyfinSecret] === 'string' && !!raw[k as keyof JellyfinSecret])) {
        throw new Error('Incomplete media connection credentials')
    }
    let url: URL
    try { url = new URL(raw.baseUrl!) } catch { throw new Error('Invalid media server address') }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid media server address')
    return { baseUrl: url.href.replace(/\/+$/, ''), accessToken: raw.accessToken!, deviceId: raw.deviceId!, userId: raw.userId! }
}

export async function sealJellyfinSecret(secret: JellyfinSecret, seal: Cipher): Promise<Record<string, string>> {
    const valid = parseJellyfinSecret(JSON.stringify(secret))
    return { jellyfin: await seal(JSON.stringify(valid)) }
}

export async function openJellyfinSecret(connection: Pick<Connection, 'credentials' | 'mediaServer'>, open: Cipher): Promise<JellyfinSecret> {
    if (!connection.credentials?.jellyfin) throw new Error('Sign in to this media server on this device')
    const secret = parseJellyfinSecret(await open(connection.credentials.jellyfin))
    if (secret.userId !== connection.mediaServer?.userId) throw new Error('Media connection user mapping does not match its credentials')
    return secret
}

// These cleartext records go only into an explicitly credential-inclusive backup or the
// encrypted sync envelope. Never submit them to the provider credential/reconciliation API.
export async function exportJellyfinCredentials(connection: Connection, open: Cipher): Promise<Record<string, string>> {
    if (!connection.credentials?.jellyfin) return {}
    return { jellyfinExport: JSON.stringify(await openJellyfinSecret(connection, open)) }
}

export async function importJellyfinCredentials(connection: Partial<Connection>, seal: Cipher, open?: Cipher): Promise<Partial<Connection>> {
    if (connection.platform !== 'jellyfin') return connection
    const incoming = connection.credentials || {}
    // Portable plaintext: validate the shape and the remote user mapping, then seal with
    // the destination key. Only the sealed `jellyfin` value is ever stored, so plaintext
    // fields can never survive into stored credentials.
    if (typeof incoming.jellyfinExport === 'string' && incoming.jellyfinExport) {
        const secret = parseJellyfinSecret(incoming.jellyfinExport)
        if (secret.userId !== connection.mediaServer?.userId) throw new Error('Imported media connection has a different remote user')
        return { ...connection, credentials: await sealJellyfinSecret(secret, seal) }
    }
    // Legacy same-key ciphertext is trusted only when the optional opener decrypts and
    // validates it against this record's user mapping. Otherwise require fresh sign-in;
    // opaque foreign ciphertext is never stored as-is.
    if (open && typeof incoming.jellyfin === 'string' && incoming.jellyfin) {
        try {
            const secret = parseJellyfinSecret(await open(incoming.jellyfin))
            if (secret.userId === connection.mediaServer?.userId) {
                return { ...connection, credentials: await sealJellyfinSecret(secret, seal) }
            }
        } catch { /* unvalidatable: fall through to re-auth */ }
    }
    return { ...connection, credentials: {}, status: 'pending', lastError: MEDIA_SIGN_IN_REQUIRED }
}

// An unreadable media credential must not prevent unrelated accounts from syncing.
// Keep the mapping visible and require fresh sign-in instead of guessing a user.
export async function recoverJellyfinConnection<T extends Partial<Connection>>(
    connection: T,
    transform: (connection: T) => Promise<T>,
): Promise<T> {
    if (connection.platform !== 'jellyfin') return connection
    try { return await transform(connection) } catch {
        return { ...connection, credentials: {}, status: 'pending', lastError: MEDIA_SIGN_IN_REQUIRED }
    }
}
