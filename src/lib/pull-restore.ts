// Only send an ETag when local slices still represent the previously applied cloud state.

export interface PullEtagInputs {
    storedEtag: string | null
    sessionUnlocked: boolean
    lastSyncedNotesCount: number | null
    localNotesEmpty: boolean
    lastAppliedAccountCount?: number | null
    localAccountCount?: number
    lastAppliedAddonCount?: number | null
    localAddonCount?: number
}

export function shouldSendPullEtag(inputs: PullEtagInputs): boolean {
    if (!inputs.storedEtag || !inputs.sessionUnlocked) return false
    // Snapshots without slice counts require one full pull.
    if (inputs.lastAppliedAccountCount == null || inputs.lastAppliedAddonCount == null) return false
    if (inputs.localNotesEmpty && (inputs.lastSyncedNotesCount ?? 0) > 0) return false
    if (inputs.localAccountCount === 0 && (inputs.lastAppliedAccountCount ?? 0) > 0) return false
    if (inputs.localAddonCount === 0 && (inputs.lastAppliedAddonCount ?? 0) > 0) return false
    return true
}

export function readServerSyncTimestamp(value: unknown): string | null {
    if (typeof value !== 'string') return null
    const time = Date.parse(value)
    return Number.isFinite(time) ? new Date(time).toISOString() : null
}

export interface AccountPullModeInputs {
    isRemoteNewer: boolean
    hasRemoteData: boolean
    // True when this pull follows a rejected push whose local changes never
    // reached the cloud. Merge preserves those unsynced local additions and
    // deletions (tombstone-aware via the account importer); mirroring would
    // replace them with the winner's state. Explicit mirror stays wholesale.
    postConflict: boolean
}

// Accounts decision for a full pull. Pure so the conflict→refresh interaction
// is unit-testable against the real production rule.
export function shouldMirrorAccountPull(inputs: AccountPullModeInputs): boolean {
    if (inputs.postConflict) return false
    return inputs.isRemoteNewer
}
