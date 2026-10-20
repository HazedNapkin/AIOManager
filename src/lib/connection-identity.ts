import type { Account } from '@/types/account'
import type { Connection } from '@/types/connection'

// Pure identity rules for accounts that hold SEVERAL connections on one platform.
// Kept free of store, vault and network dependencies so the multiplicity invariants
// (one canonical addon login per platform, individually bound secondaries) stay
// testable in isolation.

/**
 * All stored native Stremio logins, in stored order. A hydra-outbound connection
 * whose platform slug is 'stremio' is a push target, never an authKey/history
 * login, so it must never be treated as one (identity, mirror, fanout).
 */
export function stremioConnectionsOf(connections: Connection[] | undefined): Connection[] {
    return (connections || []).filter(c =>
        c.platform === 'stremio' && (c.connectionType == null || c.connectionType === 'native')
    )
}

/**
 * The canonical (account-level) Stremio connection. With several Stremio logins bound
 * to one local account exactly one is canonical: the account's primary addon
 * connection when that is a Stremio connection, otherwise the first stored Stremio
 * connection — stable, and backwards compatible with the pre-multiplicity era where
 * the single stored connection (or the legacy account.authKey) was the only login.
 */
export function resolvePrimaryStremio(
    connections: Connection[] | undefined,
    primaryConnectionId: string | undefined,
): Connection | undefined {
    const stored = stremioConnectionsOf(connections)
    if (stored.length === 0) return undefined
    return stored.find(c => c.id === primaryConnectionId) ?? stored[0]
}

export interface StremioWriteTarget {
    connectionId: string
    encryptedAuthKey: string
    email?: string
    isPrimary: boolean
}

/** Ordered Stremio write targets: canonical connection first, then the remaining enabled logins. */
export function planStremioFanout(
    connections: Connection[] | undefined,
    primaryConnectionId: string | undefined,
): StremioWriteTarget[] {
    const primaryId = resolvePrimaryStremio(connections, primaryConnectionId)?.id
    const ordered = [...stremioConnectionsOf(connections)].sort((a, b) => {
        if (a.id === primaryId) return -1
        if (b.id === primaryId) return 1
        return 0
    })
    return ordered
        .filter(c => c.enabled !== false && !!c.credentials?.authKey)
        .map(c => ({
            connectionId: c.id,
            encryptedAuthKey: c.credentials.authKey,
            email: c.credentials?.email,
            isPrimary: c.id === primaryId,
        }))
}

/**
 * Every Stremio login an addon push must reach for this account, including the legacy
 * shape (account.authKey with no stored connection) so pre-connection accounts keep
 * receiving writes exactly as before.
 *
 * The legacy fallback applies ONLY while no native Stremio connection is stored at
 * all: once a login is bound as a connection, writes follow the connection list —
 * an all-disabled/keyless connection set means "push nothing", never a silent
 * detour through the legacy account.authKey mirror of a possibly different login.
 */
export function planStremioAccountWrites(account: Pick<Account, 'id' | 'authKey' | 'email' | 'connections' | 'primaryConnectionId'>): StremioWriteTarget[] {
    if (stremioConnectionsOf(account.connections).length > 0) {
        return planStremioFanout(account.connections, account.primaryConnectionId)
    }
    if (!account.authKey || account.authKey.length <= 60) return []
    return [{
        connectionId: `${account.id}:stremio`,
        encryptedAuthKey: account.authKey,
        email: account.email,
        isPrimary: true,
    }]
}

/**
 * A login refresh rotates ONE Stremio session: only the canonical connection's sealed
 * key is rewritten. Secondary logins bound to the same account keep their own keys.
 */
export function scopeStremioKeyRotation(
    connections: Connection[] | undefined,
    primaryConnectionId: string | undefined,
    encryptedAuthKey: string,
): Connection[] {
    const primary = resolvePrimaryStremio(connections, primaryConnectionId)
    if (!primary) return connections || []
    return (connections || []).map(c =>
        c.id === primary.id
            ? { ...c, credentials: { ...c.credentials, authKey: encryptedAuthKey } }
            : c
    )
}

/**
 * The value account.authKey should hold after a connection is removed. account.authKey
 * is the legacy mirror of the CANONICAL Stremio login (modern accounts keep it empty):
 * unlinking a secondary login must not clear it, and unlinking the canonical login must
 * not leave it pointing at a session that is no longer bound.
 */
export function stremioAuthKeyMirrorAfterRemoval(args: {
    connections: Connection[] | undefined
    removedConnectionId: string
    primaryConnectionId: string | undefined
    previousAuthKey: string
}): string {
    const { connections, removedConnectionId, primaryConnectionId, previousAuthKey } = args
    const remaining = stremioConnectionsOf(connections).filter(c => c.id !== removedConnectionId)
    if (remaining.length === 0) return ''
    if (!previousAuthKey) return ''
    // Both ciphertexts are sealed with the same vault key, so mirroring the sealed
    // value keeps the mirror decryptable without a round trip.
    return resolvePrimaryStremio(remaining, primaryConnectionId)?.credentials?.authKey ?? ''
}
