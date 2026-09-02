// Credential sync is identity, not telemetry - it runs even with the activity engine off.

export interface CredentialHealAccount {
    id: string
    hasClientStremioKey: boolean
}

// True when at least one account holds a client-side Stremio key that the server-side
// credential set does not cover. A null set means "never learned" (legacy/older server):
// the response adoption turns it non-null on the first push, but until then a one-shot
// best-effort upload is the fail-safe direction — the route upserts idempotently.
export function needsCredentialHeal(
    serverCredentialedIds: string[] | null,
    accounts: CredentialHealAccount[]
): boolean {
    if (accounts.length === 0) return false
    if (serverCredentialedIds === null) return accounts.some(a => a.hasClientStremioKey)
    const credentialed = new Set(serverCredentialedIds)
    return accounts.some(a => a.hasClientStremioKey && !credentialed.has(a.id))
}
