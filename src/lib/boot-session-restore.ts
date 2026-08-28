import { getAnyRecord, isRecordExpired, type DeviceRecord } from './device-store.ts'

/**
 * Returns the remembered-device record only when it can silently re-establish a server
 * credential on boot: an IndexedDB-tier record (secret stored locally, unwrap needs no
 * user gesture) that has not expired. PRF records (secret behind a passkey gesture),
 * expired records, and absent records all return null.
 *
 * Used by authStore.initialize: since the remembered-device release the account password
 * is never persisted, so a sessionStorage-restored vault key alone is a credentialless
 * session - every request would carry deriveSyncToken('') and 401 on all password-verified
 * routes. Unlocking the vault on boot requires a device credential that can actually
 * authenticate; otherwise the login gate collects one (password or device tap).
 */
export async function findVaultRestorableDeviceRecord(): Promise<DeviceRecord | null> {
    const record = await getAnyRecord().catch(() => null)
    if (!record?.deviceSecret) return null
    if (isRecordExpired(record)) return null
    return record
}
