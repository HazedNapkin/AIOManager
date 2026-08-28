import db from '../db.js'
import { decrypt } from '../crypto.js'
import { encrypt } from '../crypto.js'
import { FALLBACK_KEYS, PRIMARY_KEY } from '../keys.js'
import { getCachedAuth, setCachedAuth, hashAuthPassword } from '../state.js'
import { timingSafeEqual } from '../auth.js'
import { listStremioCredentialedAccountIds } from '../lib/stremio-credentials.js'
import { verifySyncPassword, upgradeLegacyPasswordHash } from '../lib/sync-password.js'

async function validateSyncAuth(request, reply) {
    if (request.deviceAuth?.accountUuid) return request.deviceAuth.accountUuid
    const syncUser = request.headers['x-sync-user']
    const syncPassword = request.headers['x-sync-password']
    if (!syncUser || !syncPassword) {
        reply.status(401)
        return null
    }

    const cachedPw = getCachedAuth('sync:' + syncUser)
    if (cachedPw && timingSafeEqual(cachedPw, hashAuthPassword(syncPassword))) {
        return syncUser
    }

    const row = await db.get('SELECT password FROM kv_store WHERE key = $1', [syncUser])
    if (!row) {
        reply.status(401)
        return null
    }

    const verified = await verifySyncPassword(syncPassword, row.password)
    let authorized = verified === true
    if (verified === null) {
        const decryptedPassword = decrypt(row.password, FALLBACK_KEYS)
        if (decryptedPassword && timingSafeEqual(decryptedPassword, syncPassword)) {
            authorized = true
            await upgradeLegacyPasswordHash(db, syncUser, syncPassword)
        }
    }
    if (!authorized) {
        reply.status(401)
        return null
    }

    setCachedAuth('sync:' + syncUser, syncPassword)
    return syncUser
}

export function registerActivityRoutes(fastify, activityEngine) {
    fastify.get('/api/activity/events', {
        config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        const syncUser = await validateSyncAuth(request, reply)
        if (!syncUser) return { error: 'Invalid credentials' }

        if (!activityEngine.isEnabled()) {
            return { events: [], hasMore: false, disabled: true }
        }

        const limit = Math.min(Math.max(parseInt(request.query.limit || '500', 10), 1), 5000)
        const offset = Math.max(parseInt(request.query.offset || '0', 10), 0)
        const since = parseInt(request.query.since || '0', 10)
        const accountId = request.query.accountId
        const eventType = request.query.type

        let sql = 'SELECT * FROM activity_events WHERE sync_user = $1'
        const params = [syncUser]

        if (since > 0) {
            params.push(since)
            sql += ` AND event_ts >= $${params.length}`
        }
        if (accountId) {
            params.push(accountId)
            sql += ` AND account_id = $${params.length}`
        }
        if (eventType) {
            params.push(eventType)
            sql += ` AND event_type = $${params.length}`
        }

        sql += ` ORDER BY event_ts DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`
        params.push(limit, offset)

        let events = []
        try {
            events = await db.query(sql, params)
        } catch (dbErr) {
            fastify.log.error({ category: 'Activity' }, `Events query failed: ${dbErr.message}`)
            reply.status(503)
            return { error: 'database_unavailable', events: [], hasMore: false }
        }

        return {
            events: events.map(e => ({
                id: e.id,
                accountId: e.account_id,
                accountName: e.account_name,
                itemId: e.item_id,
                uniqueItemId: e.unique_item_id,
                name: e.item_name,
                type: e.item_type,
                poster: e.poster,
                season: e.season,
                episode: e.episode,
                videoId: e.video_id,
                eventType: e.event_type,
                timestamp: e.event_ts,
                duration: e.duration,
                progress: e.progress,
                watched: e.watched,
                timesWatched: e.times_watched,
                isInProgress: e.is_in_progress === 1,
                overallTimeWatched: e.overall_time_watched,
            })),
            hasMore: events.length === limit
        }
    })

    fastify.get('/api/activity/status', {
        config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        const syncUser = await validateSyncAuth(request, reply)
        if (!syncUser) return { error: 'Invalid credentials' }

        if (!activityEngine.isEnabled()) {
            return {
                totalEvents: 0,
                totalSnapshots: 0,
                engineRunning: activityEngine.isRunning(),
                engineEnabled: false,
                engineConfig: activityEngine.getConfig?.()
            }
        }

        let eventCount = { count: 0 }
        let snapshotCount = { count: 0 }
        try {
            eventCount = await db.get(
                'SELECT COUNT(*) as count FROM activity_events WHERE sync_user = $1',
                [syncUser]
            )
            snapshotCount = await db.get(
                'SELECT COUNT(*) as count FROM activity_snapshots WHERE sync_user = $1',
                [syncUser]
            )
        } catch (dbErr) {
            fastify.log.error({ category: 'Activity' }, `Status query failed: ${dbErr.message}`)
            reply.status(503)
            return {
                error: 'database_unavailable',
                totalEvents: 0,
                totalSnapshots: 0,
                engineRunning: activityEngine.isRunning(),
                engineEnabled: activityEngine.isEnabled(),
                engineConfig: activityEngine.getConfig?.()
            }
        }

        return {
            totalEvents: Number(eventCount?.count || 0),
            totalSnapshots: Number(snapshotCount?.count || 0),
            engineRunning: activityEngine.isRunning(),
            engineEnabled: activityEngine.isEnabled(),
            engineConfig: activityEngine.getConfig?.()
        }
    })

    fastify.post('/api/activity/trigger', {
        config: { rateLimit: { max: 6, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        const syncUser = await validateSyncAuth(request, reply)
        if (!syncUser) return { error: 'Invalid credentials' }

        return activityEngine.triggerScan()
    })

    fastify.post('/api/credentials/sync', {
        config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
        bodyLimit: 1024 * 512
    }, async (request, reply) => {
        const syncUser = await validateSyncAuth(request, reply)
        if (!syncUser) return { error: 'Invalid credentials' }

        const { accounts, allAccountIds } = request.body
        if (!Array.isArray(accounts)) {
            reply.status(400)
            return { error: 'Expected { accounts: [...] }' }
        }

        if (!activityEngine.isEnabled()) {
            return { synced: 0, skipped: accounts.length, disabled: true, serverStremioCredentialedAccounts: await listStremioCredentialedAccountIds(syncUser) }
        }

        const capped = accounts.slice(0, 200)
        const existingRows = await db.query(
            'SELECT account_id, account_name, auth_key FROM server_credentials WHERE sync_user = $1',
            [syncUser]
        )
        const existingByAccount = new Map(existingRows.map(row => [row.account_id, row]))
        let upserted = 0
        let skipped = 0
        let pruned = 0
        await db.tx(async (tx) => {
            for (const acc of capped) {
                if (!acc.accountId || !acc.authKey) continue
                const credId = `${syncUser}:${acc.accountId}`
                const accountName = acc.accountName || ''
                const existing = existingByAccount.get(acc.accountId)
                if (existing) {
                    let existingAuthKey = null
                    try {
                        existingAuthKey = decrypt(existing.auth_key, FALLBACK_KEYS)
                    } catch { /* rewrite unreadable legacy credentials */ }
                    if (existingAuthKey === acc.authKey && (existing.account_name || '') === accountName) {
                        skipped++
                        continue
                    }
                }
                const encryptedAuthKey = encrypt(acc.authKey, PRIMARY_KEY)
                const now = Date.now()

                if (db.type === 'postgres') {
                    await tx.run(
                        `INSERT INTO server_credentials (id, sync_user, account_id, account_name, auth_key, updated_at)
                         VALUES ($1, $2, $3, $4, $5, $6)
                         ON CONFLICT (id) DO UPDATE SET
                            account_name = EXCLUDED.account_name,
                            auth_key = EXCLUDED.auth_key,
                            updated_at = EXCLUDED.updated_at`,
                        [credId, syncUser, acc.accountId, accountName, encryptedAuthKey, now]
                    )
                } else {
                    await tx.run(
                        `INSERT OR REPLACE INTO server_credentials (id, sync_user, account_id, account_name, auth_key, updated_at)
                         VALUES ($1, $2, $3, $4, $5, $6)`,
                        [credId, syncUser, acc.accountId, accountName, encryptedAuthKey, now]
                    )
                }
                upserted++
            }

            const knownIds = Array.isArray(allAccountIds) && allAccountIds.length > 0
                ? new Set(allAccountIds)
                : new Set(capped.filter(a => a.accountId).map(a => a.accountId))
            for (const existingId of existingByAccount.keys()) {
                if (!knownIds.has(existingId)) {
                    await tx.run(
                        'DELETE FROM server_credentials WHERE sync_user = $1 AND account_id = $2',
                        [syncUser, existingId]
                    )
                    await tx.run(
                        'DELETE FROM activity_events WHERE sync_user = $1 AND account_id = $2',
                        [syncUser, existingId]
                    )
                    await tx.run(
                        'DELETE FROM activity_snapshots WHERE sync_user = $1 AND account_id = $2',
                        [syncUser, existingId]
                    )
                    pruned++
                }
            }
        })

        return { synced: upserted, skipped, pruned, serverStremioCredentialedAccounts: await listStremioCredentialedAccountIds(syncUser) }
    })
}
