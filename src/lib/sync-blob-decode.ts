// Decode blobs with the key context that decrypted their enclosing sync payload.
// Legacy uncompressed blobs remain readable; decoding failures return null.

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

export function isValidAvatarPayload(parsed: unknown): parsed is string {
    return typeof parsed === 'string'
}

// Legacy watch payloads may omit maps, but must contain a watchEvents array.
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
