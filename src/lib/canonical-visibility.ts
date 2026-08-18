// Stremio-only by design: an account is excluded from canonical pushes only when the
// server can READ it live (a server-side Stremio credential). Nuvio/RealStream/Hydra
// credentials are write-through targets for the reconciler, and the canonical store is
// that reconciler's source — counting them as "readable" would starve it.

export function serverHasStremioCredential(
    accountId: string,
    serverStremioCredentials: string[] | null,
    hasClientStremioKey: boolean
): boolean {
    if (serverStremioCredentials === null) return hasClientStremioKey
    return serverStremioCredentials.includes(accountId)
}

export function isSplitBrainAccount(
    account: { id: string; apiKey?: string },
    hasClientStremioKey: boolean,
    serverStremioCredentials: string[] | null
): boolean {
    if (serverStremioCredentials === null) return false
    if (!hasClientStremioKey || !account.apiKey) return false
    return !serverStremioCredentials.includes(account.id)
}

export function canonicalMembershipChanged<T extends { id: string }>(
    accounts: T[],
    hasClientStremioKey: (a: T) => boolean,
    prev: string[] | null,
    next: string[] | null
): boolean {
    if (prev === null && next === null) return false
    if (prev !== null && next !== null &&
        prev.length === next.length && prev.every(id => next.includes(id))) return false
    return accounts.some(a =>
        serverHasStremioCredential(a.id, prev, hasClientStremioKey(a)) !==
        serverHasStremioCredential(a.id, next, hasClientStremioKey(a))
    )
}
