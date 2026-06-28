import crypto from 'crypto'
import db from '../db.js'
import { encrypt, decrypt } from '../crypto.js'
import { PRIMARY_KEY, FALLBACK_KEYS } from '../keys.js'
import { getCachedAuth, setCachedAuth, invalidateCachedAuth, hashAuthPassword } from '../state.js'
import { timingSafeEqual } from '../auth.js'
import { hashApiKey } from '../api-keys.js'
import { writeEncryptedIfChanged } from '../db-guards.js'
import { isRegistrationsClosed } from '../config.js'

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

        if (!id || !password) {
            reply.status(400);
            return { error: 'Missing ID or Password header' }
        }

        try {
            const row = await db.get('SELECT value, password FROM kv_store WHERE key = $1', [id])

            if (!row) {
                reply.status(401);
                return { error: 'Unauthorized: Invalid credentials' }
            }

            const cachedPw = getCachedAuth('sync:' + id)
            if (cachedPw && timingSafeEqual(cachedPw, hashAuthPassword(password))) {
            } else {
                const decryptedPassword = decrypt(row.password, FALLBACK_KEYS)
                if (!decryptedPassword || !timingSafeEqual(decryptedPassword, password)) {
                    fastify.log.warn({ category: 'Sync' }, `[${id}] Unauthorized: Password mismatch.`)
                    reply.status(401);
                    return { error: 'Unauthorized: Invalid credentials' }
                }
                setCachedAuth('sync:' + id, password)
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
            return syncData && typeof syncData === 'object' ? syncData : {}
        } catch (err) {
            fastify.log.error({ category: 'Sync' }, `[${id}] GET Error: ${err.message}`)
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
        try {
        const { id } = request.params
        const password = request.headers['x-sync-password']
        const data = request.body

        if (!id || !password) {
            reply.status(400);
            return { error: 'Missing ID or Password header' }
        }

        const contentHash = crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex')
        const clientSyncedAt = data.syncedAt ? new Date(data.syncedAt).getTime() : 0
        const serverTime = new Date().toISOString()
        data.syncedAt = serverTime

        return await db.tx(async (tx) => {
            const row = await tx.get(
                db.type === 'postgres'
                    ? 'SELECT password, content_hash, updated_at FROM kv_store WHERE key = $1 FOR UPDATE'
                    : 'SELECT password, content_hash, updated_at FROM kv_store WHERE key = $1',
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

                if (row.content_hash === contentHash) {
                    return { success: true, syncedAt: serverTime, skipped: true }
                }

                const serverUpdated = row.updated_at || 0
                if (clientSyncedAt > 0 && serverUpdated > 0 && clientSyncedAt < serverUpdated - 5000) {
                    fastify.log.info({ category: 'Server' }, `Overlap for ID ${id}: client ${new Date(clientSyncedAt).toISOString()} predates server ${new Date(serverUpdated).toISOString()}, content-hash gates the write`)
                    return { success: true, conflict: true, syncedAt: serverTime }
                }

                const encryptedVal = encrypt(JSON.stringify(data), PRIMARY_KEY)
                const encryptedPass = encrypt(password, PRIMARY_KEY)
                await tx.run(`
                    UPDATE kv_store 
                    SET value = $1, password = $2, updated_at = $3, content_hash = $4
                    WHERE key = $5
                `, [encryptedVal, encryptedPass, Date.now(), contentHash, id])
            } else {
                if (isRegistrationsClosed()) {
                    reply.status(403);
                    return { error: 'Registrations are closed on this instance.' }
                }
                const encryptedVal = encrypt(JSON.stringify(data), PRIMARY_KEY)
                const encryptedPass = encrypt(password, PRIMARY_KEY)
                await tx.run(`
                    INSERT INTO kv_store (key, value, password, updated_at, content_hash)
                    VALUES ($1, $2, $3, $4, $5)
                `, [id, encryptedVal, encryptedPass, Date.now(), contentHash])
            }

            const apiKeys = data.apiKeys
            if (apiKeys && typeof apiKeys === 'object') {
                await tx.run('DELETE FROM account_api_keys WHERE sync_user = $1', [id])
                for (const [accountId, apiKey] of Object.entries(apiKeys)) {
                    if (typeof apiKey !== 'string' || !apiKey) continue
                    const keyHash = hashApiKey(apiKey)
                    await tx.run(
                        db.type === 'postgres'
                            ? 'INSERT INTO account_api_keys (account_id, sync_user, api_key_hash, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (sync_user, api_key_hash) DO UPDATE SET account_id = EXCLUDED.account_id, created_at = EXCLUDED.created_at'
                            : 'INSERT OR REPLACE INTO account_api_keys (account_id, sync_user, api_key_hash, created_at) VALUES ($1, $2, $3, $4)',
                        [accountId, id, keyHash, Date.now()]
                    )
                }
            }

            // Server-readable canonical addon lists: the Hydra inbound source for Hubs the
            // server can't otherwise read (Nuvio-only / local-only). Midnight-safe: the guard
            // no-ops when an account's addon list is unchanged, so re-syncs don't churn the row.
            const canonicalAddons = data.canonicalAddons
            if (canonicalAddons && typeof canonicalAddons === 'object') {
                const now = Date.now()
                for (const [accountId, addons] of Object.entries(canonicalAddons)) {
                    if (!accountId || !Array.isArray(addons)) continue
                    await tx.run(
                        db.type === 'postgres'
                            ? 'INSERT INTO account_canonical_addons (account_id, sync_user, updated_at) VALUES ($1, $2, $3) ON CONFLICT (account_id) DO NOTHING'
                            : 'INSERT OR IGNORE INTO account_canonical_addons (account_id, sync_user, updated_at) VALUES ($1, $2, $3)',
                        [accountId, id, now]
                    )
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
            return { success: true, syncedAt: serverTime }
        })
        } catch (err) {
            fastify.log.error({ category: 'Sync' }, `POST /api/sync error: ${err.message}`)
            reply.status(500)
            return { error: 'Internal sync error' }
        }
    })

    fastify.delete('/api/sync/:id', {
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        try {
        const { id } = request.params
        const password = request.headers['x-sync-password']

        fastify.log.info({ category: 'Server' }, `Received DELETE request for ID: ${id}`)

        if (!id || !password) {
            fastify.log.warn({ category: 'Server' }, `DELETE failed: Missing header for ID ${id}`)
            reply.status(400);
            return { error: 'Missing ID or Password header' }
        }

        const row = await db.get('SELECT password FROM kv_store WHERE key = $1', [id])

        if (!row) {
            fastify.log.warn({ category: 'Server' }, `DELETE failed: ID ${id} not found`)
            reply.status(401);
            return { error: 'Unauthorized: Invalid credentials' }
        }

        const cachedPw = getCachedAuth('sync:' + id)
        if (cachedPw && timingSafeEqual(cachedPw, hashAuthPassword(password))) {
        } else {
            const decryptedPassword = decrypt(row.password, FALLBACK_KEYS)
            if (!timingSafeEqual(decryptedPassword, password)) {
                fastify.log.warn({ category: 'Server' }, `DELETE failed: Password mismatch for ID ${id}`)
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
        })
        invalidateCachedAuth('sync:' + id)

        return { success: true }
        } catch (err) {
            fastify.log.error({ category: 'Server' }, `DELETE failed: ${err.message}`)
            reply.status(500)
            return { error: 'Internal server error' }
        }
    })
}
