import crypto from 'crypto'
import db from '../db.js'
import { encrypt, decrypt } from '../crypto.js'
import { PRIMARY_KEY, FALLBACK_KEYS } from '../keys.js'
import { getCachedAuth, setCachedAuth, invalidateCachedAuth, hashAuthPassword } from '../state.js'
import { timingSafeEqual } from '../auth.js'
import { hashApiKey } from '../api-keys.js'
import { writeEncryptedIfChanged } from '../db-guards.js'
import { invalidateCanonicalAddons } from './hydra.js'
import { listStremioCredentialedAccountIds } from '../lib/stremio-credentials.js'
import { isRegistrationsClosed } from '../config.js'
import { trace } from '../utils/trace.js'

function buildMultiRowPlaceholders(numRows, numCols) {
    const rows = []
    let p = 1
    for (let r = 0; r < numRows; r++) {
        const cols = []
        for (let c = 0; c < numCols; c++) {
            cols.push(`$${p++}`)
        }
        rows.push(`(${cols.join(', ')})`)
    }
    return rows.join(', ')
}

const KV_HISTORY_KEEP = 3

async function archiveCurrentKV(tx, key, authUser) {
    try {
        const now = Date.now()
        await tx.run(
            `INSERT INTO kv_store_history (key, value, password, updated_at, content_hash, archived_at)
             SELECT key, value, password, updated_at, content_hash, $1 FROM kv_store WHERE key = $2`,
            [now, key]
        )
        await tx.run(
            `DELETE FROM kv_store_history WHERE key = $1 AND archived_at NOT IN (
                 SELECT archived_at FROM kv_store_history WHERE key = $1 ORDER BY archived_at DESC LIMIT $2
             )`,
            [key, KV_HISTORY_KEEP]
        )
        trace('syncRoute', 'kv.archived', { accountId: key, by: authUser || 'system' })
    } catch (err) {
        trace('syncRoute', 'kv.archive.failed', { accountId: key, error: err && err.message })
    }
}

export function registerSyncRoutes(fastify) {
    fastify.get('/api/sync/:id', {
        config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
        schema: {
            params: {
                type: 'object',
                properties: {
                    id: { type: 'string' }
                }
            },
            response: {
                200: {
                    type: 'object',
                    additionalProperties: true
                }
            }
        }
    }, async (request, reply) => {
        const { id } = request.params
        const password = request.headers['x-sync-password']
        const start = Date.now()
        trace('syncRoute', 'pull.start', { accountId: id })

        if (!id || !password) {
            trace('syncRoute', 'pull.error', { accountId: id, error: 'missing-credentials' })
            reply.status(400);
            return { error: 'Missing ID or Password header' }
        }

        try {
            const row = await db.get('SELECT value, password, content_hash FROM kv_store WHERE key = $1', [id])

            if (!row) {
                trace('syncRoute', 'pull.error', { accountId: id, error: 'not-found' })
                reply.status(401);
                return { error: 'Unauthorized: Invalid credentials' }
            }

            const cachedPw = getCachedAuth('sync:' + id)
            if (cachedPw && timingSafeEqual(cachedPw, hashAuthPassword(password))) {
            } else {
                const decryptedPassword = decrypt(row.password, FALLBACK_KEYS)
                if (!decryptedPassword || !timingSafeEqual(decryptedPassword, password)) {
                    fastify.log.warn({ category: 'Sync' }, `[${id}] Unauthorized: Password mismatch.`)
                    trace('syncRoute', 'pull.error', { accountId: id, error: 'password-mismatch' })
                    reply.status(401);
                    return { error: 'Unauthorized: Invalid credentials' }
                }
                setCachedAuth('sync:' + id, password)
            }

            if (row.content_hash && request.headers['if-none-match'] === row.content_hash) {
                trace('syncRoute', 'pull.not_modified', { accountId: id, timing: Date.now() - start })
                reply.status(304)
                reply.header('ETag', row.content_hash)
                return reply.send()
            }

            const decryptedValueStr = decrypt(row.value, FALLBACK_KEYS)
            const needsMigration = (row.password && typeof row.password === 'string' && !row.password.includes(':')) ||
                (row.value && typeof row.value === 'string' && !row.value.includes(':'))

            if (needsMigration) {
                fastify.log.info({ category: 'Sync' }, `[${id}] Upgrading sync data to Zero-Knowledge storage.`)
                const encryptedPass = encrypt(password, PRIMARY_KEY)
                const encryptedVal = encrypt(decryptedValueStr, PRIMARY_KEY)
                db.run('UPDATE kv_store SET password = $1, value = $2, updated_at = $3 WHERE key = $4',
                    [encryptedPass, encryptedVal, Date.now(), id]).catch(err => {
                        fastify.log.error({ category: 'Sync' }, `[${id}] Migration write failed: ${err.message}`)
                    })
            }

            let syncData = {}
            if (decryptedValueStr) {
                try {
                    syncData = typeof decryptedValueStr === 'string' ? JSON.parse(decryptedValueStr) : decryptedValueStr
                } catch (e) {
                    fastify.log.warn({ category: 'Sync' }, `[${id}] Failed to parse sync data: ${e.message}`)
                    syncData = {}
                }
            }
            const payloadBytes = decryptedValueStr ? decryptedValueStr.length : 0
            trace('syncRoute', 'pull.success', { accountId: id, bytes: payloadBytes, timing: Date.now() - start })
            if (row.content_hash) reply.header('ETag', row.content_hash)
            return syncData && typeof syncData === 'object' ? syncData : {}
        } catch (err) {
            fastify.log.error({ category: 'Sync' }, `[${id}] GET Error: ${err.message}`)
            trace('syncRoute', 'pull.error', { accountId: id, error: err.message, timing: Date.now() - start })
            reply.status(500);
            return { error: 'Server error, please try again later.' }
        }
    })




    fastify.post('/api/sync/:id', {
        config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
        schema: {
            params: {
                type: 'object',
                properties: { id: { type: 'string' } }
            },
            body: {
                type: 'object',
                additionalProperties: true
            }
        }
    }, async (request, reply) => {
        const postStart = Date.now()
        try {
        const { id } = request.params
        const password = request.headers['x-sync-password']
        const data = request.body
        trace('syncRoute', 'push.start', { accountId: id, compressed: !!data?.compressed })

        if (!id || !password) {
            trace('syncRoute', 'push.error', { accountId: id, error: 'missing-credentials' })
            reply.status(400);
            return { error: 'Missing ID or Password header' }
        }

        const bodyStr = JSON.stringify(data)
        const contentHash = crypto.createHash('sha256').update(bodyStr).digest('hex')
        const clientSyncedAt = data.syncedAt ? new Date(data.syncedAt).getTime() : 0
        // contentHint is the client's hash of its logical state (pre-syncedAt stamp); unlike
        // content_hash (over the random-IV envelope, never stable), a match proves the logical
        // content is unchanged so archive/rewrite/apiKeys churn and the updated_at bump skip.
        const clientHint = typeof data.contentHint === 'string' ? data.contentHint.slice(0, 64) : null
        const serverTime = new Date().toISOString()
        data.syncedAt = serverTime
        const storedStr = JSON.stringify(data)

        const serverStremioCredentialedAccounts = await listStremioCredentialedAccountIds(id)

        return await db.tx(async (tx) => {
            const row = await tx.get(
                db.type === 'postgres'
                    ? 'SELECT password, content_hash, content_hint, updated_at FROM kv_store WHERE key = $1 FOR UPDATE'
                    : 'SELECT password, content_hash, content_hint, updated_at FROM kv_store WHERE key = $1',
                [id]
            )

            if (row) {
                const cachedPw = getCachedAuth('sync:' + id)
                if (cachedPw && timingSafeEqual(cachedPw, hashAuthPassword(password))) {
                } else {
                    const decryptedPassword = decrypt(row.password, FALLBACK_KEYS)
                    if (!timingSafeEqual(decryptedPassword, password)) {
                        reply.status(401);
                        return { error: 'Unauthorized: Password mismatch' }
                    }
                    setCachedAuth('sync:' + id, password)
                }

                if (clientHint && row.content_hint === clientHint) {
                    trace('syncRoute', 'push.success', { accountId: id, skipped: true, reason: 'hint-match', timing: Date.now() - postStart })
                    return { success: true, syncedAt: serverTime, skipped: true, contentHash: row.content_hash, serverStremioCredentialedAccounts }
                }

                if (row.content_hash === contentHash) {
                    trace('syncRoute', 'push.success', { accountId: id, skipped: true, reason: 'hash-match', timing: Date.now() - postStart })
                    return { success: true, syncedAt: serverTime, skipped: true, contentHash: row.content_hash, serverStremioCredentialedAccounts }
                }

                const serverUpdated = row.updated_at || 0
                if (clientSyncedAt > 0 && serverUpdated > 0 && clientSyncedAt < serverUpdated - 5000) {
                    fastify.log.info({ category: 'Server' }, `Overlap for ID ${id}: client ${new Date(clientSyncedAt).toISOString()} predates server ${new Date(serverUpdated).toISOString()}, content-hash gates the write`)
                    trace('syncRoute', 'push.success', { accountId: id, skipped: true, reason: 'conflict', timing: Date.now() - postStart })
                    return { success: true, conflict: true, syncedAt: serverTime, contentHash: row.content_hash ?? null, serverStremioCredentialedAccounts }
                }

                await archiveCurrentKV(tx, id, id)

                const encryptedVal = encrypt(storedStr, PRIMARY_KEY)
                const encryptedPass = encrypt(password, PRIMARY_KEY)
                await tx.run(`
                    UPDATE kv_store
                    SET value = $1, password = $2, updated_at = $3, content_hash = $4, content_hint = $5
                    WHERE key = $6
                `, [encryptedVal, encryptedPass, Date.now(), contentHash, clientHint, id])
            } else {
                if (isRegistrationsClosed()) {
                    reply.status(403);
                    return { error: 'Registrations are closed on this instance.' }
                }
                const encryptedVal = encrypt(storedStr, PRIMARY_KEY)
                const encryptedPass = encrypt(password, PRIMARY_KEY)
                await tx.run(`
                    INSERT INTO kv_store (key, value, password, updated_at, content_hash, content_hint)
                    VALUES ($1, $2, $3, $4, $5, $6)
                `, [id, encryptedVal, encryptedPass, Date.now(), contentHash, clientHint])
            }

            const apiKeys = data.apiKeys
            if (apiKeys && typeof apiKeys === 'object') {
                const existingKeyAccounts = new Set(
                    (await tx.query('SELECT DISTINCT account_id FROM account_api_keys WHERE sync_user = $1', [id])).map(r => r.account_id),
                )
                // Wipe-without-insert guard: DELETE-all + reinsert from the pushed map means a
                // client whose store lost an account's apiKey (stale pull overwriting a regen,
                // import, rehydration race) silently unregisters a working key — both old and
                // new keys then 401 forever. If the account is still in the pushed blob but
                // its key vanished from the map, retain the stored key: nothing in the UI
                // ever removes a key (regen REPLACES it in the same push), so a missing key
                // for a present account is always client-side divergence, never intent.
                const pushedAccounts = Array.isArray(data.accounts) ? data.accounts : null
                if (pushedAccounts) {
                    const presentIds = new Set(pushedAccounts.map(a => a && a.id).filter(Boolean))
                    const retained = [...existingKeyAccounts].filter(accId => presentIds.has(accId) && !(accId in apiKeys))
                    if (retained.length > 0) {
                        fastify.log.warn({ category: 'Sync' }, `API-key wipe guard: retained stored key(s) for ${retained.length} account(s) still present but keyless in the push (${retained.join(', ').slice(0, 200)}).`)
                        const retainedParams = [id, ...retained]
                        await tx.run(
                            `DELETE FROM account_api_keys WHERE sync_user = $1 AND account_id NOT IN (${retained.map((_, i) => `$${i + 2}`).join(',')})`,
                            retainedParams,
                        )
                    } else {
                        await tx.run('DELETE FROM account_api_keys WHERE sync_user = $1', [id])
                    }
                } else {
                    await tx.run('DELETE FROM account_api_keys WHERE sync_user = $1', [id])
                }
                const apiKeyRows = []
                const seenHashes = new Map()
                for (const [accountId, apiKey] of Object.entries(apiKeys)) {
                    if (typeof apiKey !== 'string' || !apiKey) continue
                    const h = hashApiKey(apiKey)
                    const existing = seenHashes.get(h)
                    if (existing !== undefined) apiKeyRows[existing] = null
                    seenHashes.set(h, apiKeyRows.length)
                    apiKeyRows.push([accountId, id, h, Date.now()])
                }
                const dedupedRows = apiKeyRows.filter(Boolean)
                const API_KEY_CHUNK = 100
                for (let i = 0; i < dedupedRows.length; i += API_KEY_CHUNK) {
                    const chunk = dedupedRows.slice(i, i + API_KEY_CHUNK)
                    if (chunk.length === 0) continue
                    const placeholders = buildMultiRowPlaceholders(chunk.length, 4)
                    const params = chunk.flat()
                    // Plain INSERT: the DELETE above clears cross-push rows and the
                    // batch is deduped in-memory, so no conflict clause is needed — the
                    // upsert must not hard-depend on idx_api_keys_user_hash existing.
                    const sql = `INSERT INTO account_api_keys (account_id, sync_user, api_key_hash, created_at) VALUES ${placeholders}`
                    await tx.run(sql, params)
                }
            }

            // Server-readable canonical addon lists: the Hydra inbound source for Hubs the
            // server can't otherwise read (Nuvio-only / local-only). Midnight-safe: the guard
            // no-ops when an account's addon list is unchanged, so re-syncs don't churn the row.
            const canonicalAddons = data.canonicalAddons
            const canonicalWrites = []
            if (canonicalAddons && typeof canonicalAddons === 'object') {
                const now = Date.now()
                const emptyCanonicalIds = new Set()
                const canonicalRows = []
                for (const [accountId, addons] of Object.entries(canonicalAddons)) {
                    if (!accountId || !Array.isArray(addons)) continue
                    canonicalRows.push([accountId, id, now])
                    if (addons.length === 0) emptyCanonicalIds.add(accountId)
                    canonicalWrites.push([accountId, addons])
                }
                // Shrink guard (mirror of the client fold's inbound-deletes-don't-shrink):
                // a client that never folded an external push has local=[] for an account
                // whose server store is populated; pushing that empty list would destroy
                // the external write. An empty incoming list never overwrites a non-empty
                // store UNLESS the client flags the hub in emptiedHubs — the fold marks a
                // hub once it merges external content in, so a later empty push from a
                // marked hub is a deliberate full removal, not a fold-starved client.
                const emptiedHubs = Array.isArray(data.emptiedHubs)
                    ? new Set(data.emptiedHubs.filter(h => typeof h === 'string'))
                    : new Set()
                if (emptyCanonicalIds.size > 0) {
                    for (const accountId of emptyCanonicalIds) {
                        if (emptiedHubs.has(accountId)) continue
                        const row = await tx.get(
                            'SELECT addon_list FROM account_canonical_addons WHERE account_id = $1 AND sync_user = $2',
                            [accountId, id],
                        )
                        if (row?.addon_list) {
                            const decrypted = decrypt(row.addon_list, FALLBACK_KEYS)
                            if (decrypted) {
                                try {
                                    const parsed = JSON.parse(decrypted)
                                    if (Array.isArray(parsed) && parsed.length > 0) {
                                        const idx = canonicalWrites.findIndex(([aid]) => aid === accountId)
                                        if (idx >= 0) canonicalWrites.splice(idx, 1)
                                        fastify.log.warn({ category: 'Sync' }, `Canonical shrink guard: kept ${parsed.length} stored addon(s) for account ${accountId} (push carried an empty list — likely unfolded external write).`)
                                    }
                                } catch {}
                            }
                        }
                    }
                }
                const CANONICAL_CHUNK = 100
                for (let i = 0; i < canonicalRows.length; i += CANONICAL_CHUNK) {
                    const chunk = canonicalRows.slice(i, i + CANONICAL_CHUNK)
                    if (chunk.length === 0) continue
                    const placeholders = buildMultiRowPlaceholders(chunk.length, 3)
                    const params = chunk.flat()
                    const sql = db.type === 'postgres'
                        ? `INSERT INTO account_canonical_addons (account_id, sync_user, updated_at) VALUES ${placeholders} ON CONFLICT (account_id) DO NOTHING`
                        : `INSERT OR IGNORE INTO account_canonical_addons (account_id, sync_user, updated_at) VALUES ${placeholders}`
                    await tx.run(sql, params)
                }
                for (const [accountId, addons] of canonicalWrites) {
                    await writeEncryptedIfChanged(
                        'account_canonical_addons',
                        { sql: 'account_id = $1', params: [accountId] },
                        'addon_list',
                        JSON.stringify(addons),
                        { alsoSet: { sync_user: id, updated_at: now }, runner: tx },
                    )
                }
            }

            invalidateCachedAuth('sync:' + id)
            for (const [accountId] of canonicalWrites) {
                invalidateCanonicalAddons(accountId, id)
            }
            trace('syncRoute', 'push.success', { accountId: id, bytes: storedStr.length, timing: Date.now() - postStart })
            return { success: true, syncedAt: serverTime, contentHash, serverStremioCredentialedAccounts }
        })
        } catch (err) {
            fastify.log.error({ category: 'Sync' }, `POST /api/sync error: ${err.message}`)
            trace('syncRoute', 'push.error', { accountId: request.params?.id, error: err.message, timing: Date.now() - postStart })
            reply.status(500)
            return { error: 'Internal sync error' }
        }
    })

    fastify.post('/api/sync/:id/restore', {
        config: { rateLimit: { max: 5, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        const restoreStart = Date.now()
        const { id } = request.params
        const password = request.headers['x-sync-password']
        trace('syncRoute', 'restore.start', { accountId: id })

        if (!id || !password) {
            reply.status(400)
            return { error: 'Missing ID or Password header' }
        }

        try {
            const row = await db.get('SELECT password FROM kv_store WHERE key = $1', [id])
            if (!row) {
                reply.status(401)
                return { error: 'Unauthorized: Invalid credentials' }
            }

            const cachedPw = getCachedAuth('sync:' + id)
            if (!(cachedPw && timingSafeEqual(cachedPw, hashAuthPassword(password)))) {
                const decryptedPassword = decrypt(row.password, FALLBACK_KEYS)
                if (!decryptedPassword || !timingSafeEqual(decryptedPassword, password)) {
                    reply.status(401)
                    return { error: 'Unauthorized: Invalid credentials' }
                }
                setCachedAuth('sync:' + id, password)
            }

            const result = await db.tx(async (tx) => {
                const archived = await tx.get(
                    'SELECT value, password, content_hash, updated_at FROM kv_store_history WHERE key = $1 ORDER BY archived_at DESC LIMIT 1',
                    [id]
                )
                if (!archived) return { restored: false }

                await tx.run(
                    `UPDATE kv_store SET value = $1, password = $2, updated_at = $3, content_hash = $4, content_hint = NULL WHERE key = $5`,
                    [archived.value, archived.password, archived.updated_at, archived.content_hash, id]
                )
                return { restored: true }
            })

            invalidateCachedAuth('sync:' + id)
            trace('syncRoute', 'restore.done', { accountId: id, restored: result?.restored, timing: Date.now() - restoreStart })
            if (!result?.restored) {
                reply.status(404)
                return { error: 'No previous cloud version is available to restore' }
            }
            return { success: true, restored: true }
        } catch (err) {
            fastify.log.error({ category: 'Sync' }, `POST /api/sync/${id}/restore error: ${err.message}`)
            trace('syncRoute', 'restore.error', { accountId: id, error: err.message, timing: Date.now() - restoreStart })
            reply.status(500)
            return { error: 'Internal restore error' }
        }
    })

    fastify.delete('/api/sync/:id', {
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        const delStart = Date.now()
        try {
        const { id } = request.params
        const password = request.headers['x-sync-password']
        trace('syncRoute', 'delete.start', { accountId: id })

        fastify.log.info({ category: 'Server' }, `Received DELETE request for ID: ${id}`)

        if (!id || !password) {
            fastify.log.warn({ category: 'Server' }, `DELETE failed: Missing header for ID ${id}`)
            trace('syncRoute', 'delete.error', { accountId: id, error: 'missing-credentials' })
            reply.status(400);
            return { error: 'Missing ID or Password header' }
        }

        const row = await db.get('SELECT password FROM kv_store WHERE key = $1', [id])

        if (!row) {
            fastify.log.warn({ category: 'Server' }, `DELETE failed: ID ${id} not found`)
            trace('syncRoute', 'delete.error', { accountId: id, error: 'not-found' })
            reply.status(401);
            return { error: 'Unauthorized: Invalid credentials' }
        }

        const cachedPw = getCachedAuth('sync:' + id)
        if (cachedPw && timingSafeEqual(cachedPw, hashAuthPassword(password))) {
        } else {
            const decryptedPassword = decrypt(row.password, FALLBACK_KEYS)
            if (!timingSafeEqual(decryptedPassword, password)) {
                fastify.log.warn({ category: 'Server' }, `DELETE failed: Password mismatch for ID ${id}`)
                trace('syncRoute', 'delete.error', { accountId: id, error: 'password-mismatch' })
                reply.status(401);
                return { error: 'Unauthorized: Invalid credentials' }
            }
            setCachedAuth('sync:' + id, password)
        }

        fastify.log.info({ category: 'Server' }, `Deleting all data for sync user: ${id}`)
        await db.tx(async (tx) => {
            await tx.run('DELETE FROM activity_events WHERE sync_user = $1', [id])
            await tx.run('DELETE FROM activity_snapshots WHERE sync_user = $1', [id])
            await tx.run('DELETE FROM account_canonical_addons WHERE sync_user = $1', [id])
            await tx.run('DELETE FROM server_credentials WHERE sync_user = $1', [id])
            // Without these, deleting a sync user leaves valid API keys + subscriber rows that
            // still authenticate to /hydra/* for the now-deleted user.
            await tx.run('DELETE FROM account_api_keys WHERE sync_user = $1', [id])
            await tx.run('DELETE FROM hydra_subscribers WHERE sync_user = $1', [id])
            await tx.run('DELETE FROM autopilot_rule_stats WHERE rule_id IN (SELECT id FROM autopilot_rules WHERE owner_sync_user = $1)', [id])
            await tx.run('DELETE FROM failover_history WHERE rule_id IN (SELECT id FROM autopilot_rules WHERE owner_sync_user = $1)', [id])
            await tx.run('DELETE FROM autopilot_rules WHERE owner_sync_user = $1', [id])
            await tx.run('DELETE FROM kv_store WHERE key = $1', [id])
            await tx.run('DELETE FROM kv_store_history WHERE key = $1', [id])
        })
        invalidateCachedAuth('sync:' + id)
        trace('syncRoute', 'delete.success', { accountId: id, timing: Date.now() - delStart })

        return { success: true }
        } catch (err) {
            fastify.log.error({ category: 'Server' }, `DELETE failed: ${err.message}`)
            trace('syncRoute', 'delete.error', { accountId: request.params?.id, error: err.message, timing: Date.now() - delStart })
            reply.status(500)
            return { error: 'Internal server error' }
        }
    })
}
