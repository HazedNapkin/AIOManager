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
