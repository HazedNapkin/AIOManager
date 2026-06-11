// Decides how a cloud-sync restore should handle the per-account encryption salt.
//
// The salt (USER_SALT) derives the vault key that encrypts every account authKey and vault
// entry. If the wrong salt is used, the derived key is different and silently fails to decrypt
// that data. So the rules are:
//   - A salt stored in the cloud record is authoritative (the record's data was encrypted with it).
//   - If the record carries no salt, a device-local salt may be used (the original device's salt),
//     but it must NEVER be invented when there is existing data to mis-decrypt.
//   - Only a definitively-correct salt may be pushed back to the cloud: a freshly-minted one for an
//     empty account. A device-local fallback for a record with data is not eagerly re-pushed
//     (a normal validated sync handles that), so a foreign leftover salt can't corrupt the record.
//
// Pure and dependency-free so the branches can be unit-tested directly.

export interface RestoreSaltInput {
    cloudSalt?: string
    localSalt?: string
    hasEncryptedData: boolean
}

export interface RestoreSaltPolicy {
    saltToUse?: string
    /** Whether unlockFromSync may generate a fresh salt (only safe with no existing data). */
    allowGenerate: boolean
    /** Refuse the restore: existing data but no recoverable salt. */
    refuse: boolean
    /** Safe to push this salt to the cloud to heal a salt-less record. */
    backfill: boolean
}

export function resolveRestoreSaltPolicy(input: RestoreSaltInput): RestoreSaltPolicy {
    const { cloudSalt, localSalt, hasEncryptedData } = input
    const cloudHadSalt = !!cloudSalt
    const saltToUse = cloudSalt || localSalt || undefined

    return {
        saltToUse,
        allowGenerate: !hasEncryptedData,
        refuse: !saltToUse && hasEncryptedData,
        backfill: !cloudHadSalt && !hasEncryptedData,
    }
}
