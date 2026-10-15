// Shared decoder for the out-of-band sync blobs (avatar, watch history). The
// inner state and its blobs are encrypted with the SAME key on push, so the
// caller resolves the winning branch ONCE (device unlock key, session
// credential, or password+salt) and passes exactly that context here; blobs
// must never re-resolve keys from mutable store state, where a stale stored
// salt or credential wins over the one that actually decoded the response.
// Blobs are deflated before encryption; the uncompressed sniff keeps legacy
// blobs readable. Returns null when the blob cannot be decoded so the caller
// keeps local state instead of throwing the whole pull away.

export interface SyncBlobKeys {
    deviceSyncKey?: CryptoKey | null
    sessionSyncKeyB64?: string | null
    password?: string
    salt?: Uint8Array
}

export async function decodeSyncBlob(blob: string, keys: SyncBlobKeys): Promise<string | null> {
    try {
        const { decryptSyncPayload, decryptSyncPayloadWithKey, importSyncKey } = await import('@/lib/crypto')
        const { decompressSyncPayload } = await import('@/lib/sync-payload-codec')
        let json: string
        if (keys.deviceSyncKey) {
            json = await decryptSyncPayloadWithKey(blob, keys.deviceSyncKey)
        } else if (keys.sessionSyncKeyB64) {
            const sessionSyncKey = await importSyncKey(Uint8Array.from(atob(keys.sessionSyncKeyB64), c => c.charCodeAt(0)))
            json = await decryptSyncPayloadWithKey(blob, sessionSyncKey)
        } else {
            json = await decryptSyncPayload(blob, keys.password ?? '', keys.salt)
        }
        try { return await decompressSyncPayload(json) } catch { return json }
    } catch {
        return null
    }
}

// Shape contracts for decoded blob payloads. A blob that decrypts to the wrong
// TYPE is as unreadable as one that fails to decrypt: applying it would certify
// a pull or mirror that silently dropped the slice it carried. Valid legacy
// absence is decided by the callers (no blob at all = nothing to validate).

// The avatar blob carries exactly one JSON string; the empty string is a valid
// (empty) avatar.
export function isValidAvatarPayload(parsed: unknown): parsed is string {
    return typeof parsed === 'string'
}

// The watch blob carries the structured watch payload. watchEvents must be an
// array; the other maps must be plain objects when present (older pushes may
// omit them). Anything else (null, array, mistyped fields) is invalid.
export function isValidWatchPayload(parsed: unknown): parsed is Record<string, unknown> {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
    const watch = parsed as Record<string, unknown>
    if (!Array.isArray(watch.watchEvents)) return false
    for (const key of ['watchSnapshot', 'deletedWatchEvents', 'watchEventRollups'] as const) {
        const value = watch[key]
        if (value === undefined) continue
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    }
    return true
}
