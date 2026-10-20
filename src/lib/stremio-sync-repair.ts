// Guarded client-side repair for the split-brain Stremio credential warning: the API
// key works for external Hydra writes, but the server holds no Stremio credential for
// this account, so those writes can only land in the server store until some
// AIOManager client pushes the credential. The existing post-push auto-heal
// (syncStore, needsCredentialHeal) already covers the silent path; this helper is the
// explicit, user-triggered path behind the warning's "Repair Stremio sync" action.
//
// Honesty contract — deliberately stricter than the upload's aggregate count:
//   * Success is ONLY the account's id appearing in the authoritative
//     serverStremioCredentialedAccounts readback AFTER the upload attempt. The
//     upload's return value is an aggregate across accounts: a nonzero number is NOT
//     per-account evidence, and a zero return with a confirming readback (e.g. a
//     racing push healed the account first) still counts.
//   * A locked vault, a signed-out session, a warning that no longer applies, a
//     disabled canonical login, or an account/workspace/auth/vault-key change DURING
//     the await must never report success — the readback alone is not trusted across
//     a moved context.
//
// Per-account identity is an exact Stremio credential fingerprint (primary pointer,
// canonical login, every native login's id/enabled/sealed key/userId, the legacy
// account-level key mirror, and the API key VALUE): booleans cannot distinguish a
// re-pointed primary, a re-logged-in credential, or a rotated API key, and all three
// must withhold success. Sealed values are compared as stored — identity only; the
// fingerprint never decrypts anything. This mirrors, per account, the ownership stamp
// the upload core itself checks (activity-server stremioIdentityStamp); that core
// guard remains in force unchanged.
//
// Import-free and dependency-injected on purpose so `node --test` can exercise every
// guard without pulling the store graph; the store wiring lives in
// useStremioSyncRepair, which owns the same guards' real-data sources.

export type StremioSyncRepairFailureReason =
    | 'signed-out'
    | 'vault-locked'
    | 'precondition'
    | 'disabled'
    | 'context-switched'
    | 'not-confirmed'

export type StremioSyncRepairResult =
    | { status: 'repaired' }
    | { status: 'failed'; reason: StremioSyncRepairFailureReason }

/** Ownership fingerprint of the world the repair asserts about, captured twice:
 *  once before the upload await and once after. Reference equality on vaultKeyRef
 *  mirrors the activity-server guard: a rotation swaps the key object. */
export interface StremioSyncRepairSession {
    workspaceId: string
    authId: string
    isAuthenticated: boolean
    serverUrl: string
    vaultKeyRef: unknown
}

/** One native Stremio login as stored: identity + enabled + SEALED credential values.
 *  Comparing sealed bytes is credential identity without ever decrypting. */
export interface StremioSyncLoginFacts {
    connectionId: string
    enabled: boolean
    authKey: string
    userId: string
}

/** Exact per-account Stremio credential identity. A byte change anywhere — primary
 *  re-point (raw pointer or effective canonical), login added/removed/disabled,
 *  sealed credential rotation, legacy key-mirror change, or API key rotation — means
 *  the world the repair started in is gone and success must be withheld. */
export interface StremioCredentialFacts {
    /** Raw primary connection pointer; null when unset. */
    primaryConnectionId: string | null
    /** Effective canonical login id (the primary when it is Stremio, else the first
     *  stored login; the synthetic id for legacy authKey-only accounts). */
    canonicalConnectionId: string | null
    /** True unless the effective canonical login is explicitly disabled. Legacy
     *  authKey-only accounts have no enabled notion and stay true. */
    canonicalEnabled: boolean
    /** Legacy account-level Stremio key mirror (sealed value identity). */
    accountAuthKey: string
    /** API key VALUE identity — a rotation during the await must not claim success
     *  for the account as it was when the repair started. */
    apiKey: string
    /** Every stored native Stremio login, in stored order. */
    logins: StremioSyncLoginFacts[]
}

/** The split-brain preconditions that made the warning render: the account exists
 *  and holds a client-side Stremio credential. Re-checked after the await with the
 *  full fingerprint. */
export interface StremioSyncRepairAccountState {
    exists: boolean
    /** null = no client-side Stremio credential at all (warning no longer applies). */
    stremio: StremioCredentialFacts | null
}

export interface StremioSyncRepairDeps {
    accountId: string
    getSession: () => StremioSyncRepairSession
    getAccountState: (accountId: string) => StremioSyncRepairAccountState
    /** The existing credential upload (activity-server syncCredentialsToServer). */
    syncCredentials: () => Promise<number>
    /** The authoritative learned server set: string[] | null (null = never learned). */
    getServerCredentialedAccounts: () => string[] | null
}

function accountFactsHold(state: StremioSyncRepairAccountState): boolean {
    // An empty apiKey means the split-brain precondition (API key active) is gone.
    return state.exists && state.stremio !== null && state.stremio.apiKey !== ''
}

function sessionFactsHold(start: StremioSyncRepairSession, end: StremioSyncRepairSession): boolean {
    return start.workspaceId === end.workspaceId
        && start.authId === end.authId
        && start.isAuthenticated === end.isAuthenticated
        && start.serverUrl === end.serverUrl
        && start.vaultKeyRef === end.vaultKeyRef
}

function stremioFingerprint(facts: StremioCredentialFacts): string {
    // canonicalEnabled is derived from logins + canonical id and is not restated here;
    // every disable/enable flip changes a login's enabled flag below regardless.
    return JSON.stringify([
        facts.primaryConnectionId,
        facts.canonicalConnectionId,
        facts.accountAuthKey,
        facts.apiKey,
        facts.logins.map(l => [l.connectionId, l.enabled, l.authKey, l.userId]),
    ])
}

export async function attemptStremioSyncRepair(deps: StremioSyncRepairDeps): Promise<StremioSyncRepairResult> {
    // Pre-flight guards, all synchronous before any await: an unauthenticated,
    // vault-locked, or disabled-canonical client must not even start the upload (a
    // disabled canonical upload would tell the server to DROP the credential row —
    // the opposite of repair).
    const startSession = deps.getSession()
    if (!startSession.isAuthenticated) return { status: 'failed', reason: 'signed-out' }
    if (startSession.vaultKeyRef === null || startSession.vaultKeyRef === undefined) {
        return { status: 'failed', reason: 'vault-locked' }
    }
    const startAccount = deps.getAccountState(deps.accountId)
    if (!accountFactsHold(startAccount)) return { status: 'failed', reason: 'precondition' }
    if (!startAccount.stremio!.canonicalEnabled) return { status: 'failed', reason: 'disabled' }
    const startFingerprint = stremioFingerprint(startAccount.stremio!)

    try {
        await deps.syncCredentials()
    } catch {
        // The upload core swallows transport failures as 0; if it ever throws instead,
        // fall through — the authoritative readback below decides, never the throw.
    }

    // Post-await ownership re-check: everything the repair asserted about must still
    // describe the same world, or the readback below could be someone else's evidence.
    const endSession = deps.getSession()
    if (!sessionFactsHold(startSession, endSession)) return { status: 'failed', reason: 'context-switched' }
    const endAccount = deps.getAccountState(deps.accountId)
    if (!accountFactsHold(endAccount)) return { status: 'failed', reason: 'context-switched' }
    if (!endAccount.stremio!.canonicalEnabled) return { status: 'failed', reason: 'disabled' }
    if (stremioFingerprint(endAccount.stremio!) !== startFingerprint) {
        return { status: 'failed', reason: 'context-switched' }
    }

    const learned = deps.getServerCredentialedAccounts()
    if (learned !== null && learned.includes(deps.accountId)) return { status: 'repaired' }
    return { status: 'failed', reason: 'not-confirmed' }
}
