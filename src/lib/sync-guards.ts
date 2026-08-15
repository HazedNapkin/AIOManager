// Data-loss guards for the sync push path: the destructive direction is local-empty
// + previously-populated. A store that silently reads as 0 accounts is a failure
// state (failed hydration, locked-vault partial import), not a real user state.
// Rationale lives here once; call sites stay comment-free.

export interface EmptyPushGuardState {
    currentAccountCount: number
    lastSyncedAccountCount: number | null
    isManualPush: boolean
}

export function shouldBlockEmptyAccountPush(s: EmptyPushGuardState): boolean {
    if (s.currentAccountCount > 0) return false
    if (s.lastSyncedAccountCount === null) return false
    if (s.lastSyncedAccountCount === 0) return false
    // Reaching 0 from a populated last-known state via an explicit user action is a
    // legitimate "delete everything" — only automatic/background pushes are blocked.
    return !s.isManualPush
}
