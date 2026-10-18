import type { Connection, MediaServerIdentity } from '../types/connection.ts'
import { isAddonConnection } from '../types/connection.ts'
import { MEDIA_SIGN_IN_REQUIRED } from './jellyfin/connection-data.ts'

// Sync incoming connections carry metadata only (credentials live server-side), so local
// credentials must be preserved. Backup imports carry credentials, which take precedence.
// Media connections are the exception: they keep one browser-only sealed value under
// `jellyfin`, already validated/rewrapped by importJellyfinCredentials before this merge.
export function mergeConnections(
    local: Connection[] | undefined,
    incoming: Partial<Connection>[] | undefined,
    mode: 'merge' | 'mirror',
): Connection[] | undefined {
    if (!incoming) return local
    const localById = new Map((local || []).map(c => [c.id, c]))
    const merged: Connection[] = incoming
        .filter(inc => inc.id && inc.platform)
        .map(inc => {
            const existing = localById.get(inc.id as string)
            const credentials = mergeConnectionCredentials(existing, inc)
            const record = {
                status: 'active',
                lastSync: 0,
                lastKnownAddonCount: 0,
                consecutiveFailures: 0,
                ...(existing || {}),
                ...inc,
                credentials,
            } as Connection
            return inc.platform === 'jellyfin' ? finalizeMediaRecord(record, credentials, existing) : record
        })
    if (mode === 'merge') {
        const incomingIds = new Set(merged.map(c => c.id))
        const mergedPlatforms = new Set(merged.map(c => c.platform))
        for (const c of local || []) {
            if (incomingIds.has(c.id)) continue
            // Only one connection per addon platform survives; media connections are
            // independent per server/user and always survive a merge.
            if (c.platform !== 'jellyfin' && mergedPlatforms.has(c.platform)) continue
            merged.push(c)
        }
    }
    return merged
}

function mergeConnectionCredentials(existing: Connection | undefined, inc: Partial<Connection>): Record<string, string> {
    if (inc.platform !== 'jellyfin') {
        return { ...(existing?.credentials || {}), ...(inc.credentials || {}) }
    }
    // A sealed value here was rewrapped under the destination key from validated portable
    // plaintext, so it replaces the local one. Only the `jellyfin` value is ever retained.
    if (typeof inc.credentials?.jellyfin === 'string' && inc.credentials.jellyfin) {
        return { jellyfin: inc.credentials.jellyfin }
    }
    // Metadata-only incoming: keep the local sealed credential only when the remote
    // user/server mapping is unchanged. A different or unverifiable mapping must not
    // inherit the local token; it requires a fresh sign-in instead.
    if (existing?.credentials?.jellyfin && sameMediaServerMapping(existing.mediaServer, inc.mediaServer)) {
        return { jellyfin: existing.credentials.jellyfin }
    }
    return {}
}

function sameMediaServerMapping(a: MediaServerIdentity | undefined, b: MediaServerIdentity | undefined): boolean {
    if (!a?.userId || !b?.userId || a.userId !== b.userId) return false
    if (a.serverId !== b.serverId) return false
    return true
}

// A media connection without a usable sealed credential is pending sign-in, never active.
// With a credential present it works on this device even when the exporter was pending.
function finalizeMediaRecord(record: Connection, credentials: Record<string, string>, existing: Connection | undefined): Connection {
    if (!credentials.jellyfin) {
        return { ...record, status: 'pending', lastError: record.lastError || MEDIA_SIGN_IN_REQUIRED }
    }
    if (record.status !== 'pending') return record
    const status = existing?.status && existing.status !== 'pending' ? existing.status : 'active'
    const lastError = record.lastError === MEDIA_SIGN_IN_REQUIRED ? undefined : record.lastError
    return { ...record, status, lastError }
}

// Media connections are never addon primaries. Repoint imports whose primary refers to a
// media or removed record at an eligible addon connection, or leave it unset.
export function resolvePrimaryConnectionId(
    connections: Connection[] | undefined,
    preferred: string | undefined,
): string | undefined {
    const list = connections || []
    if (preferred && list.some(c => c.id === preferred && isAddonConnection(c))) return preferred
    return list.find(c => isAddonConnection(c))?.id
}
