import db from '../db.js'
import { decrypt } from '../crypto.js'
import { FALLBACK_KEYS } from '../keys.js'

const STREMIO_CRED_PREDICATE = "(credential_type = 'stremio' OR credential_type IS NULL)"

export async function listStremioCredentialedAccountIds(syncUser) {
    const rows = await db.query(
        `SELECT DISTINCT account_id FROM server_credentials WHERE sync_user = $1 AND ${STREMIO_CRED_PREDICATE}`,
        [syncUser]
    )
    return rows.map(r => r.account_id)
}

export async function stremioCredentialVersion(syncUser) {
    return db.get(
        `SELECT COUNT(*) AS n, MAX(updated_at) AS max_ts FROM server_credentials WHERE sync_user = $1 AND ${STREMIO_CRED_PREDICATE}`,
        [syncUser]
    )
}

export async function getLatestStremioCredential(accountId, syncUser) {
    return db.get(
        `SELECT auth_key FROM server_credentials WHERE account_id = $1 AND sync_user = $2 AND ${STREMIO_CRED_PREDICATE} ORDER BY updated_at DESC LIMIT 1`,
        [accountId, syncUser]
    )
}

export async function resolveStremioAuthKey(accountId, syncUser) {
    const row = await getLatestStremioCredential(accountId, syncUser)
    if (!row?.auth_key) return null
    return decrypt(row.auth_key, FALLBACK_KEYS) || null
}
