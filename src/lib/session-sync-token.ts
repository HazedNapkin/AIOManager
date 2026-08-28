/**
 * Session-scoped sync credential persistence (live bug #52).
 *
 * Since the raw password stopped being persisted, a page refresh leaves
 * `auth.password` empty, so every header builder derived
 * `x-sync-password: deriveSyncToken('')` — a constant garbage token that 401s
 * stremio-proxy, Nuvio QR, backup-export, connection refresh and re-auth
 * persistence, while the push gate silently skipped ("no in-session
 * credentials").
 *
 * At successful login we persist the DERIVED wire credential into sessionStorage:
 * the SHA-256 sync token (the exact x-sync-password value the server verifies)
 * plus the base64 raw sync-encryption key, so pushes after a refresh encrypt
 * with the correct key (same trust tier as the remembered-device blob's stored
 * syncKey — the vault AES key already lives raw in sessionStorage under
 * 'aioman:session-key'). The raw password itself is NEVER stored, in any form.
 *
 * Scope rules: sessionStorage only (survives a refresh in the same tab, dies
 * when the tab closes — a closed tab means sign in again, identical to the
 * pre-e4edd08 contract), account-id-scoped on read, cleared by logout,
 * deactivateDeviceAuth(), lock() and 401 session wipes. Read-at-use: the
 * storage IS the restore path, so there is no boot hydration race to lose.
 *
 * Alias-free (zero imports) so the resolution logic is unit-testable under
 * `node --test` (see session-sync-token.test.ts).
 */

const SESSION_SYNC_TOKEN_KEY = 'aiom-session-sync-token'

export interface SessionSyncCredential {
    /** SHA-256 wire token (deriveSyncToken output) — the x-sync-password header value. */
    token: string
    /** Base64 raw sync-encryption key (exportSyncKeyRaw output) for password-less pushes. */
    syncKey: string
}

interface StoredShape {
    id?: unknown
    token?: unknown
    syncKey?: unknown
}

function readStored(): ({ id: string } & SessionSyncCredential) | null {
    try {
        const raw = sessionStorage.getItem(SESSION_SYNC_TOKEN_KEY)
        if (!raw) return null
        const parsed = JSON.parse(raw) as StoredShape
        // A token without its sync key would pass the push gate but produce
        // undecryptable payloads — shape validation is load-bearing.
        if (typeof parsed.id !== 'string' || !parsed.id) return null
        if (typeof parsed.token !== 'string' || !parsed.token) return null
        if (typeof parsed.syncKey !== 'string' || !parsed.syncKey) return null
        return { id: parsed.id, token: parsed.token, syncKey: parsed.syncKey }
    } catch {
        // Storage unavailable (SSR/node) or a corrupt payload: read as no credential.
        return null
    }
}

export function saveSessionSyncToken(id: string, token: string, syncKey: string): boolean {
    if (!id || !token || !syncKey) return false
    try {
        sessionStorage.setItem(SESSION_SYNC_TOKEN_KEY, JSON.stringify({ id, token, syncKey }))
        return true
    } catch {
        // Storage blocked (private mode/quota): the session continues on the
        // in-memory password alone — same failure mode as the pre-fix world.
        return false
    }
}

/** Id-validated read: a stored credential only ever answers for its own account. */
export function getSessionSyncCredential(accountId: string): SessionSyncCredential | null {
    const stored = readStored()
    if (!stored || stored.id !== accountId) return null
    return { token: stored.token, syncKey: stored.syncKey }
}

export function hasSessionSyncCredential(accountId: string): boolean {
    return getSessionSyncCredential(accountId) !== null
}

/**
 * Single resolution rule for every x-sync-password builder: the stored session
 * token IS the valid wire credential and wins (it equals the token the current
 * password would derive); without one, derive from the in-memory password as
 * before. `deriveSyncToken` is injected so this module stays import-free.
 */
export async function resolveSessionWireToken(
    accountId: string,
    password: string,
    deriveSyncToken: (password: string) => Promise<string>
): Promise<string> {
    const credential = getSessionSyncCredential(accountId)
    if (credential) return credential.token
    return deriveSyncToken(password)
}

export function clearSessionSyncToken(): void {
    try {
        sessionStorage.removeItem(SESSION_SYNC_TOKEN_KEY)
    } catch {
        // Storage already unavailable: nothing to clear.
    }
}
