// Canonical Stremio identity transitions that the server must be told about exactly
// once. Deliberate events produce a pending note:
//   - re-point: the canonical login changed (primary switch, or removal promoting a
//     survivor). The demoted login's bare-account server history must MOVE to its
//     `accountId::connectionId` scope so the new canonical seeds fresh.
//   - last-login removal: no native Stremio login remains. The stale account-level
//     credential row (which account-level server APIs would keep acting on) and the
//     bare-scope history are pruned — only on this explicit signal, never on a decrypt
//     failure or a disabled login.
//
// Async/multi-step correctness rules:
//   * notes are namespaced per workspace+sync-user, so a second workspace or identity on
//     the same origin never fires (or clears) another's transition;
//   * a rapid A→B→C before any sync keeps the FIRST demoted id (A) — the server's bare
//     rows still belong to A until the migration lands;
//   * notes are cleared only when still equal to what the in-flight sync captured, so a
//     transition recorded while the POST was out is never lost;
//   * a login added after a last-login removal converts the pending removal into a
//     re-point (migrate the old history) instead of revoking the new login.

import { getActiveWorkspaceId } from './workspace-persistence'

type PendingEntry = {
    supersededConnectionId?: string
    loginsRemoved?: true
    removedCanonicalConnectionId?: string
}
type PendingMap = Record<string, PendingEntry>

const KEY_PREFIX = 'aio-stremio-repoint-pending-v1'
const SYNC_STATE_KEY = 'aioman-sync'

function namespace(): string {
    let workspace = 'default'
    try { workspace = getActiveWorkspaceId() || 'default' } catch { /* unreadable workspace id: default namespace */ }
    let owner = ''
    try {
        // Mirror resolveWorkspaceIdFromSnapshot's read of the per-workspace sync state:
        // state.auth.id identifies the owner whose server these notes must reach.
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SYNC_STATE_KEY) : null
        if (raw) {
            const parsed = JSON.parse(raw)
            const id = parsed?.state?.auth?.id
            owner = typeof id === 'string' && id ? id : ''
        }
    } catch { /* best-effort discriminator */ }
    return `${KEY_PREFIX}:${workspace}:${owner || 'anon'}`
}

function readPending(): PendingMap {
    try {
        const raw = localStorage.getItem(namespace())
        if (!raw) return {}
        const parsed = JSON.parse(raw) as PendingMap
        return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
        return {}
    }
}

function writePending(map: PendingMap) {
    try { localStorage.setItem(namespace(), JSON.stringify(map)) } catch { /* storage unavailable: the next explicit transition retries */ }
}

function sameEntry(a: PendingEntry | undefined, b: PendingEntry | undefined): boolean {
    return a?.supersededConnectionId === b?.supersededConnectionId
        && a?.loginsRemoved === b?.loginsRemoved
        && a?.removedCanonicalConnectionId === b?.removedCanonicalConnectionId
}

/**
 * Record that `accountId`'s canonical Stremio login moved off `supersededConnectionId`.
 * First-wins while unsynced: A→B→C keeps A, the login the server's bare rows still
 * describe.
 */
export function noteStremioCanonicalRepoint(accountId: string, supersededConnectionId: string) {
    if (!accountId || !supersededConnectionId) return
    const map = readPending()
    const entry = map[accountId] || {}
    if (!entry.supersededConnectionId) entry.supersededConnectionId = supersededConnectionId
    delete entry.loginsRemoved
    delete entry.removedCanonicalConnectionId
    map[accountId] = entry
    writePending(map)
}

/**
 * Record that `accountId` no longer has ANY native Stremio login (deliberate removal).
 * `removedCanonicalConnectionId` carries the unlinked canonical's id when it was a real
 * stored connection, so a login added before the next sync converts this into a re-point
 * instead of a revoke.
 */
export function noteStremioLoginsRemoved(accountId: string, removedCanonicalConnectionId?: string) {
    if (!accountId) return
    const map = readPending()
    map[accountId] = { loginsRemoved: true, ...(removedCanonicalConnectionId ? { removedCanonicalConnectionId } : {}) }
    writePending(map)
}

/**
 * A new Stremio login was just added to an account with an UNSYNCED last-login removal:
 * the new login must never be revoked. With a known removed canonical the note becomes a
 * re-point (the old history migrates to the removed login's scope); without one the note
 * is dropped (the pre-multiplicity legacy shape had no per-login identity to attribute).
 */
export function convertPendingLoginsRemovedToRepoint(accountId: string) {
    const map = readPending()
    const entry = map[accountId]
    if (!entry?.loginsRemoved) return
    if (entry.removedCanonicalConnectionId) {
        map[accountId] = { supersededConnectionId: entry.removedCanonicalConnectionId }
    } else {
        delete map[accountId]
    }
    writePending(map)
}

/** Read the pending transitions for the credential sync (call immediately before POST). */
export function takePendingStremioRepoints(): PendingMap {
    return readPending()
}

/** Clear a consumed note only if it still equals what the sync captured. */
export function clearPendingStremioRepoint(accountId: string, captured: PendingEntry | undefined) {
    const map = readPending()
    if (accountId in map && sameEntry(map[accountId], captured)) {
        delete map[accountId]
        writePending(map)
    }
}
