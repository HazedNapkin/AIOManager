// Decision for the pull's If-None-Match shortcut. The 304 path returns without
// applying anything, so it is only safe when the local state can actually be
// the state the server calls unchanged: a workspace whose index was wiped
// (sign-out wipe, storage eviction) while the cloud still holds the notes it
// pulled would otherwise freeze at an empty view until the content changed.

export interface PullEtagInputs {
    storedEtag: string | null
    sessionUnlocked: boolean
    lastSyncedNotesCount: number | null
    localNotesEmpty: boolean
}

export function shouldSendPullEtag(inputs: PullEtagInputs): boolean {
    if (!inputs.storedEtag || !inputs.sessionUnlocked) return false
    if (inputs.localNotesEmpty && (inputs.lastSyncedNotesCount ?? 0) > 0) return false
    return true
}
