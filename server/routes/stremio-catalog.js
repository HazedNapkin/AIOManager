import db from '../db.js'
import { verifyAuth } from '../auth.js'
import crypto from 'crypto'

const MAX_CATALOG_ITEMS = 100
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const PUBLISH_THROTTLE_MS = 6 * 60 * 60 * 1000
const REC_CACHE_TYPES = new Set(['recommended_movies', 'recommended_series', 'recommended_anime', 'because_you_watched', 'themed_rows'])
const HOUSEHOLD_ACCOUNT_ID = '__household__'

function corsHeaders(reply) {
    reply.header('Access-Control-Allow-Origin', '*')
    reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS, POST')
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

async function getRecCacheItems(syncUser, accountId, catalogType) {
    if (!REC_CACHE_TYPES.has(catalogType)) return null
    const effectiveAccountId = accountId || HOUSEHOLD_ACCOUNT_ID
    try {
        const row = await db.get(
            `SELECT items, updated_at FROM recommendation_cache
             WHERE sync_user = $1 AND account_id = $2 AND catalog_type = $3`,
            [syncUser, effectiveAccountId, catalogType]
        )
        if (!row?.items) return null
        const age = Date.now() - Number(row.updated_at || 0)
        if (age > SEVEN_DAYS_MS) return { items: null, stale: true }
        const items = typeof row.items === 'string' ? JSON.parse(row.items) : row.items
        if (!Array.isArray(items) || items.length === 0) return null
        return { items, stale: false }
    } catch {
        return null
    }
}

const CATALOG_DEFINITIONS = {
    continue_watching: { name: 'Continue Watching', types: ['movie', 'series'] },
    recommended_movies: { name: 'Recommended Movies', types: ['movie'] },
    recommended_series: { name: 'Recommended Series', types: ['series'] },
    recommended_anime: { name: 'Recommended Anime', types: ['series'] },
    because_you_watched: { name: 'Because You Watched', types: ['movie', 'series'] },
    themed_rows: { name: 'Themed For You', types: ['movie', 'series'] },
    popular_household: { name: 'Popular in Household', types: ['movie', 'series'] },
    trending_household: { name: 'Trending This Week', types: ['movie', 'series'] },
    watchlist: { name: 'My Watchlist', types: ['movie', 'series'] },
}

function generateCatalogsFromPrefs(prefs, scope) {
    if (!prefs || !Array.isArray(prefs.catalogs)) return []
    const isHousehold = scope === 'household'
    const result = []
    for (const entry of prefs.catalogs) {
        if (!entry || typeof entry.id !== 'string') continue
        const isLocked = entry.locked === true
        const isEnabled = entry.enabled === true
        if (!isLocked && !isEnabled) continue
        const def = CATALOG_DEFINITIONS[entry.id]
        if (!def) continue
        const skipHouseholdOnly = !isHousehold && (entry.id === 'popular_household' || entry.id === 'trending_household')
        if (skipHouseholdOnly) continue
        for (const type of def.types) {
            result.push({ type, id: entry.id, name: def.name })
        }
    }
    return result
}

async function resolveToken(token) {
    const row = await db.get('SELECT value FROM kv_store WHERE key = $1', [`catalog_token:${token}`])
    if (!row?.value) return null
    try {
        return JSON.parse(row.value)
    } catch {
        return null
    }
}

async function ensureToken(syncUser, accountId, accountName, baseUrl) {
    const scope = accountId ? 'account' : 'household'
    const ownerKey = `catalog_token_owner:${syncUser}:${scope}:${accountId ?? 'household'}`
    const existing = await db.get('SELECT value FROM kv_store WHERE key = $1', [ownerKey])
    if (existing?.value) {
        return `${baseUrl}/addon/${existing.value}/manifest.json`
    }
    const token = crypto.randomUUID()
    const now = Date.now()
    const tokenData = JSON.stringify({ sync_user: syncUser, account_id: accountId ?? null, scope, account_name: accountName ?? null })
    const upsertSql = db.type === 'postgres'
        ? `INSERT INTO kv_store (key, value, updated_at) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`
        : `INSERT INTO kv_store (key, value, updated_at) VALUES ($1, $2, $3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    await db.run(upsertSql, [ownerKey, token, now])
    await db.run(upsertSql, [`catalog_token:${token}`, tokenData, now])
    return `${baseUrl}/addon/${token}/manifest.json`
}

function buildCatalogQuery(catalogId, mediaType, syncUser, accountId) {
    const accountFilter = accountId ? `AND account_id = $2` : ''
    const params = accountId ? [syncUser, accountId] : [syncUser]

    switch (catalogId) {
        case 'continue_watching':
            return {
                sql: `SELECT DISTINCT item_id, item_name, item_type, poster, progress, mtime
                      FROM activity_snapshots
                      WHERE sync_user = $1 ${accountFilter}
                        AND item_type = $${accountId ? 3 : 2}
                        AND is_in_progress = 1
                        AND progress > 0 AND progress < 90
                        AND item_id != ''
                      ORDER BY mtime DESC
                      LIMIT $${accountId ? 4 : 3}`,
                params: [...params, mediaType, MAX_CATALOG_ITEMS]
            }

        case 'recently_watched':
            return {
                sql: `SELECT DISTINCT item_id, item_name, item_type, poster, mtime
                      FROM activity_snapshots
                      WHERE sync_user = $1 ${accountFilter}
                        AND item_type = $${accountId ? 3 : 2}
                        AND watched = 1
                        AND item_id != ''
                      ORDER BY mtime DESC
                      LIMIT $${accountId ? 4 : 3}`,
                params: [...params, mediaType, MAX_CATALOG_ITEMS]
            }

        case 'popular_household':
            return {
                sql: `SELECT item_id, MAX(item_name) as item_name, item_type, MAX(poster) as poster,
                        COUNT(DISTINCT account_id) as watchers
                      FROM activity_snapshots
                      WHERE sync_user = $1
                        AND item_type = $2
                        AND item_id != ''
                      GROUP BY item_id, item_type
                      ORDER BY watchers DESC, MAX(mtime) DESC
                      LIMIT $3`,
                params: [syncUser, mediaType, MAX_CATALOG_ITEMS]
            }

        case 'trending_household':
            return {
                sql: `SELECT item_id, MAX(item_name) as item_name, item_type, MAX(poster) as poster,
                        COUNT(DISTINCT account_id) as watchers
                      FROM activity_snapshots
                      WHERE sync_user = $1
                        AND item_type = $2
                        AND item_id != ''
                        AND mtime > $3
                      GROUP BY item_id, item_type
                      ORDER BY watchers DESC, MAX(mtime) DESC
                      LIMIT $4`,
                params: [syncUser, mediaType, Date.now() - SEVEN_DAYS_MS, MAX_CATALOG_ITEMS]
            }

        case 'recommended_movies':
        case 'recommended_series': {
            const recMediaType = catalogId === 'recommended_movies' ? 'movie' : 'series'
            return {
                sql: `SELECT DISTINCT item_id, item_name, item_type, poster, mtime, progress, watched
                      FROM activity_snapshots
                      WHERE sync_user = $1 ${accountFilter}
                        AND item_type = $${accountId ? 3 : 2}
                        AND item_id != ''
                        AND watched = 1
                      ORDER BY mtime DESC
                      LIMIT $${accountId ? 4 : 3}`,
                params: [...params, recMediaType, MAX_CATALOG_ITEMS]
            }
        }

        case 'hidden_gems':
            return {
                sql: `SELECT DISTINCT item_id, item_name, item_type, poster, mtime, progress, watched
                      FROM activity_snapshots
                      WHERE sync_user = $1 ${accountFilter}
                        AND item_type = $${accountId ? 3 : 2}
                        AND item_id != ''
                        AND progress > 0 AND progress < 100
                      ORDER BY mtime DESC
                      LIMIT $${accountId ? 4 : 3}`,
                params: [...params, mediaType, MAX_CATALOG_ITEMS]
            }

        default:
            return null
    }
}

function rowsToMetas(rows) {
    return (rows || []).filter(r => r.item_id && r.item_id.startsWith('tt')).map(row => {
        const meta = {
            id: row.item_id,
            type: row.item_type === 'series' ? 'series' : 'movie',
            name: row.item_name || 'Unknown',
        }
        if (row.poster) meta.poster = row.poster
        return meta
    })
}

async function getDiscoveryPrefs(syncUser, accountId) {
    const effectiveAccountId = accountId || HOUSEHOLD_ACCOUNT_ID
    try {
        const row = await db.get(
            'SELECT prefs_json FROM discovery_prefs WHERE sync_user = $1 AND account_id = $2',
            [syncUser, effectiveAccountId]
        )
        if (!row?.prefs_json) return null
        return JSON.parse(row.prefs_json)
    } catch {
        return null
    }
}

async function saveDiscoveryPrefs(syncUser, accountId, prefsJson) {
    const effectiveAccountId = accountId || HOUSEHOLD_ACCOUNT_ID
    const now = Date.now()
    const json = typeof prefsJson === 'string' ? prefsJson : JSON.stringify(prefsJson)
    await db.run(
        db.type === 'postgres'
            ? `INSERT INTO discovery_prefs (sync_user, account_id, prefs_json, updated_at) VALUES ($1, $2, $3, $4) ON CONFLICT (sync_user, account_id) DO UPDATE SET prefs_json = EXCLUDED.prefs_json, updated_at = EXCLUDED.updated_at`
            : `INSERT INTO discovery_prefs (sync_user, account_id, prefs_json, updated_at) VALUES ($1, $2, $3, $4) ON CONFLICT(sync_user, account_id) DO UPDATE SET prefs_json = excluded.prefs_json, updated_at = excluded.updated_at`,
        [syncUser, effectiveAccountId, json, now]
    )
}

function buildDefaultPrefs(scope) {
    const isHousehold = scope === 'household'
    return {
        railSize: 20,
        catalogs: [
            { id: 'recommended_movies', enabled: true, locked: true },
            { id: 'recommended_series', enabled: true, locked: true },
            { id: 'continue_watching', enabled: true, locked: true },
            { id: 'watchlist', enabled: true, locked: true },
            { id: 'because_you_watched', enabled: true, locked: false },
            { id: 'themed_rows', enabled: true, locked: false },
            { id: 'hidden_gems', enabled: false, locked: false },
            { id: 'recently_watched', enabled: false, locked: false },
            ...(isHousehold ? [
                { id: 'popular_household', enabled: true, locked: false },
                { id: 'trending_household', enabled: false, locked: false },
            ] : []),
        ],
    }
}

export function registerStremioCatalogRoutes(fastify) {
    fastify.options('/addon/:token/*', async (_request, reply) => {
        corsHeaders(reply)
        reply.code(204)
        return ''
    })

    fastify.get('/addon/:token/manifest.json', async (request, reply) => {
        corsHeaders(reply)
        const tokenData = await resolveToken(request.params.token)
        if (!tokenData) {
            reply.code(404)
            return { error: 'Invalid token' }
        }

        const { sync_user, account_id, scope, account_name } = tokenData
        const baseUrl = `${request.protocol}://${request.hostname}`
        const prefs = await getDiscoveryPrefs(sync_user, scope === 'household' ? HOUSEHOLD_ACCOUNT_ID : (account_id || HOUSEHOLD_ACCOUNT_ID))
        const effectiveCatalogs = generateCatalogsFromPrefs(prefs, scope)

        let customCatalogs = []
        try {
            const customRows = await db.query(
                'SELECT id, catalog_name, catalog_type FROM catalog_configs WHERE sync_user = $1 ORDER BY created_at DESC',
                [sync_user]
            )
            customCatalogs = (customRows || []).map(r => ({
                type: r.catalog_type || 'movie',
                id: `custom_${r.id}`,
                name: r.catalog_name,
            }))
        } catch {}

        const catalogs = [...effectiveCatalogs, ...customCatalogs]
        const name = scope === 'household'
            ? 'My Recommendations'
            : `${account_name || 'Account'} Recommendations`

        return {
            id: `com.aiomanager.${scope}.${account_id || 'household'}`,
            version: '1.0.0',
            name,
            logo: `${baseUrl}/logo.png`,
            description: `Personalized recommendations powered by AIOManager${scope === 'household' ? '' : ` for ${account_name || 'this account'}`}`,
            resources: ['catalog'],
            types: ['movie', 'series'],
            catalogs,
            behaviorHints: { configurable: false },
        }
    })

    fastify.get('/addon/:token/catalog/:type/:id.json', async (request, reply) => {
        corsHeaders(reply)
        const { token, type, id } = request.params
        const tokenData = await resolveToken(token)
        if (!tokenData) {
            reply.code(404)
            return { metas: [] }
        }

        const { sync_user, account_id } = tokenData
        const mediaType = type === 'movie' ? 'movie' : 'series'

        if (id.startsWith('custom_')) {
            const customId = id.slice(7)
            try {
                const configRow = await db.get(
                    'SELECT filters, catalog_type FROM catalog_configs WHERE id = $1 AND sync_user = $2',
                    [customId, sync_user]
                )
                if (!configRow) return { metas: [] }
                const filters = typeof configRow.filters === 'string' ? JSON.parse(configRow.filters) : {}
                const accountFilter = account_id ? `AND account_id = $2` : ''
                const params = account_id ? [sync_user, account_id] : [sync_user]
                let where = `sync_user = $1 ${accountFilter} AND item_type = $${account_id ? 3 : 2} AND item_id != ''`
                const extraParams = [...params, mediaType]
                if (filters.minProgress !== undefined) {
                    where += ` AND progress >= $${extraParams.length + 1}`
                    extraParams.push(filters.minProgress)
                }
                if (filters.maxProgress !== undefined) {
                    where += ` AND progress <= $${extraParams.length + 1}`
                    extraParams.push(filters.maxProgress)
                }
                if (filters.watchedOnly) {
                    where += ` AND watched = 1`
                }
                if (filters.inProgressOnly) {
                    where += ` AND is_in_progress = 1`
                }
                let orderBy = 'mtime DESC'
                if (filters.sortBy === 'watchers' && !account_id) {
                    orderBy = 'watchers DESC, mtime DESC'
                }
                extraParams.push(MAX_CATALOG_ITEMS)
                const sql = account_id
                    ? `SELECT DISTINCT item_id, item_name, item_type, poster FROM activity_snapshots WHERE ${where} ORDER BY ${orderBy} LIMIT $${extraParams.length}`
                    : `SELECT item_id, MAX(item_name) as item_name, item_type, MAX(poster) as poster, COUNT(DISTINCT account_id) as watchers FROM activity_snapshots WHERE ${where} GROUP BY item_id, item_type ORDER BY ${orderBy} LIMIT $${extraParams.length}`
                let rows = await db.query(sql, extraParams)

                if (filters.genres) {
                    const wantedGenres = String(filters.genres).split(',').map(g => g.trim().toLowerCase()).filter(Boolean)
                    if (wantedGenres.length > 0) {
                        rows = rows.filter(r => {
                            if (!r.genres) return true
                            const itemGenres = String(r.genres).split(',').map(g => g.trim().toLowerCase()).filter(Boolean)
                            if (itemGenres.length === 0) return true
                            return itemGenres.some(g => wantedGenres.includes(g))
                        })
                    }
                }
                if (typeof filters.minRating === 'number') {
                    rows = rows.filter(r => {
                        if (typeof r.vote_average !== 'number') return true
                        return r.vote_average >= filters.minRating
                    })
                }
                if (typeof filters.eraStart === 'number') {
                    rows = rows.filter(r => {
                        const year = r.release_year ?? r.year
                        if (typeof year !== 'number') return true
                        return year >= filters.eraStart
                    })
                }
                if (typeof filters.eraEnd === 'number') {
                    rows = rows.filter(r => {
                        const year = r.release_year ?? r.year
                        if (typeof year !== 'number') return true
                        return year <= filters.eraEnd
                    })
                }
                if (typeof filters.obscurity === 'string') {
                    const obscurityTests = {
                        popular: c => c >= 500,
                        balanced: c => c <= 10000,
                        hidden: c => c <= 2000,
                        gems: c => c <= 1000,
                        obscure: c => c <= 500,
                    }
                    const obscurityTest = obscurityTests[filters.obscurity]
                    if (obscurityTest) {
                        rows = rows.filter(r => {
                            if (typeof r.vote_count !== 'number') return true
                            return obscurityTest(r.vote_count)
                        })
                    }
                }

                return { metas: rowsToMetas(rows) }
            } catch {
                return { metas: [] }
            }
        }

        if (id === 'watchlist') {
            const effectiveAccountId = account_id || HOUSEHOLD_ACCOUNT_ID
            try {
                const rows = await db.query(
                    `SELECT item_id, item_name, item_type, poster FROM watchlist_items
                     WHERE sync_user = $1 AND account_id = $2 AND item_type = $3
                     ORDER BY added_at DESC LIMIT $4`,
                    [sync_user, effectiveAccountId, mediaType, MAX_CATALOG_ITEMS]
                )
                const metas = (rows || []).filter(r => r.item_id).map(row => {
                    const meta = {
                        id: row.item_id,
                        type: row.item_type === 'series' ? 'series' : 'movie',
                        name: row.item_name || 'Unknown',
                    }
                    if (row.poster) meta.poster = row.poster
                    return meta
                })
                return { metas }
            } catch {
                return { metas: [] }
            }
        }

        const cached = await getRecCacheItems(sync_user, account_id, id)
        if (cached?.items) {
            const metas = cached.items
                .filter(item => item.id && (!item.type || item.type === mediaType || (id === 'hidden_gems')))
                .slice(0, MAX_CATALOG_ITEMS)
                .map(item => {
                    const meta = {
                        id: item.id,
                        type: item.type === 'series' ? 'series' : 'movie',
                        name: item.name || 'Unknown',
                    }
                    if (item.poster) meta.poster = item.poster
                    return meta
                })
            if (metas.length === 0 && REC_CACHE_TYPES.has(id)) {
                reply.code(404)
                return { error: 'No recommendations available' }
            }
            return { metas }
        }

        const query = buildCatalogQuery(id, mediaType, sync_user, account_id)
        if (!query) {
            if (REC_CACHE_TYPES.has(id)) {
                reply.code(404)
                return { error: 'No recommendations available' }
            }
            return { metas: [] }
        }

        try {
            const rows = await db.query(query.sql, query.params)
            const metas = rowsToMetas(rows)
            return { metas }
        } catch {
            return { metas: [] }
        }
    })

    fastify.get('/api/catalog/tokens', async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) {
            reply.status(401)
            return { error: 'Unauthorized' }
        }

        const baseUrl = `${request.protocol}://${request.hostname}`
        const tokenRows = await db.query(
            `SELECT key, value FROM kv_store WHERE key LIKE $1`,
            [`catalog_token_owner:${authUser}:%`]
        ).catch(() => [])

        const tokens = []
        for (const row of tokenRows || []) {
            const scopeMatch = row.key.match(/catalog_token_owner:.*:(household|account):(.*)/)
            if (!scopeMatch) continue
            const [, scope, accountId] = scopeMatch
            tokens.push({
                scope,
                account_id: scope === 'account' ? accountId : null,
                url: `${baseUrl}/addon/${row.value}/manifest.json`,
            })
        }

        return { tokens }
    })

    fastify.get('/api/catalog/install-url', async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) {
            reply.status(401)
            return { error: 'Unauthorized' }
        }

        const baseUrl = `${request.protocol}://${request.hostname}`
        const url = await ensureToken(authUser, null, null, baseUrl)
        return { url }
    })

    fastify.post('/api/catalog/account-url', async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) {
            reply.status(401)
            return { error: 'Unauthorized' }
        }

        const { accountId, accountName } = request.body || {}
        if (!accountId) {
            reply.status(400)
            return { error: 'accountId required' }
        }

        const baseUrl = `${request.protocol}://${request.hostname}`
        const url = await ensureToken(authUser, accountId, accountName, baseUrl)
        return { url }
    })

    fastify.get('/api/catalog/all-urls', async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) {
            reply.status(401)
            return { error: 'Unauthorized' }
        }

        const baseUrl = `${request.protocol}://${request.hostname}`
        const householdUrl = await ensureToken(authUser, null, 'Household', baseUrl)

        const credRows = await db.query(
            `SELECT DISTINCT account_id, account_name FROM server_credentials WHERE sync_user = $1 AND account_id != '' ORDER BY account_name`,
            [authUser]
        ).catch(() => [])

        const accountUrls = []
        for (const cred of credRows || []) {
            const url = await ensureToken(authUser, cred.account_id, cred.account_name, baseUrl)
            accountUrls.push({ accountId: cred.account_id, accountName: cred.account_name, url })
        }

        return { household: householdUrl, accounts: accountUrls }
    })

    fastify.delete('/api/catalog/clear', async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) {
            reply.status(401)
            return { error: 'Unauthorized' }
        }
        try {
            await db.run('DELETE FROM stremio_catalog WHERE user_id = $1', [authUser])
            return { success: true }
        } catch {
            return { success: false }
        }
    })

    fastify.get('/api/catalog/custom', async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }
        const rows = await db.query(
            'SELECT id, catalog_name, catalog_type, filters, created_at FROM catalog_configs WHERE sync_user = $1 ORDER BY created_at DESC',
            [authUser]
        ).catch(() => [])
        return { catalogs: (rows || []).map(r => ({
            id: r.id,
            name: r.catalog_name,
            type: r.catalog_type,
            filters: typeof r.filters === 'string' ? JSON.parse(r.filters) : {},
        })) }
    })

    fastify.post('/api/catalog/custom', {
        bodyLimit: 4096,
        config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    }, async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }
        const { name, type, filters } = request.body || {}
        if (!name) { reply.status(400); return { error: 'name required' } }
        const id = crypto.randomUUID()
        const now = Date.now()
        const filterJson = JSON.stringify(filters || {})
        try {
            await db.run(
                db.type === 'postgres'
                    ? `INSERT INTO catalog_configs (id, sync_user, catalog_name, catalog_type, filters, created_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id, sync_user) DO UPDATE SET catalog_name = EXCLUDED.catalog_name, catalog_type = EXCLUDED.catalog_type, filters = EXCLUDED.filters`
                    : `INSERT INTO catalog_configs (id, sync_user, catalog_name, catalog_type, filters, created_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT(id, sync_user) DO UPDATE SET catalog_name = excluded.catalog_name, catalog_type = excluded.catalog_type, filters = excluded.filters`,
                [id, authUser, name, type || 'movie', filterJson, now]
            )
            return { success: true, id }
        } catch {
            return { success: false }
        }
    })

    fastify.delete('/api/catalog/custom/:id', async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }
        try {
            const result = await db.run('DELETE FROM catalog_configs WHERE id = $1 AND sync_user = $2', [request.params.id, authUser])
            const affected = result?.changes ?? result?.rowCount ?? 0
            if (affected === 0) {
                reply.status(404)
                return { success: false, error: 'Catalog not found or not owned by this user' }
            }
            return { success: true }
        } catch (err) {
            reply.status(500)
            return { success: false, error: `Delete failed: ${err.message}` }
        }
    })

    fastify.get('/api/catalog/prefs', async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }

        const scope = request.query?.scope === 'account' ? 'account' : 'household'
        const accountId = request.query?.accountId || HOUSEHOLD_ACCOUNT_ID
        const effectiveAccountId = scope === 'household' ? HOUSEHOLD_ACCOUNT_ID : accountId

        try {
            const prefs = await getDiscoveryPrefs(authUser, effectiveAccountId)
            return { prefs: prefs || buildDefaultPrefs(scope) }
        } catch {
            return { prefs: buildDefaultPrefs(scope) }
        }
    })

    fastify.put('/api/catalog/prefs', {
        bodyLimit: 8192,
        config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    }, async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }

        const { scope, accountId, prefs } = request.body || {}
        if (scope !== 'household' && scope !== 'account') {
            reply.status(400); return { error: 'scope must be household or account' }
        }
        if (!prefs || typeof prefs !== 'object') {
            reply.status(400); return { error: 'prefs required' }
        }
        if (typeof prefs.railSize !== 'number' || prefs.railSize < 10 || prefs.railSize > 50) {
            reply.status(400); return { error: 'railSize must be between 10 and 50' }
        }
        if (!Array.isArray(prefs.catalogs)) {
            reply.status(400); return { error: 'catalogs array required' }
        }

        const effectiveAccountId = scope === 'household' ? HOUSEHOLD_ACCOUNT_ID : (accountId || HOUSEHOLD_ACCOUNT_ID)

        try {
            await saveDiscoveryPrefs(authUser, effectiveAccountId, prefs)
            return { success: true }
        } catch {
            return { success: false }
        }
    })

    fastify.post('/api/catalog/publish-recommendations', {
        bodyLimit: 262144,
        config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
    }, async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }

        const { rails } = request.body || {}
        if (!Array.isArray(rails) || rails.length === 0) {
            reply.status(400)
            return { error: 'rails array required' }
        }

        const now = Date.now()
        const validCatalogTypes = new Set(REC_CACHE_TYPES)
        const pendingWrites = []

        for (const rail of rails) {
            if (!rail || !rail.catalogType || !validCatalogTypes.has(rail.catalogType)) continue
            if (!Array.isArray(rail.items)) continue

            const scope = rail.scope || 'household'
            let accountId = HOUSEHOLD_ACCOUNT_ID

            if (scope === 'account' && rail.accountId) {
                const cred = await db.get(
                    'SELECT account_id FROM server_credentials WHERE sync_user = $1 AND account_id = $2',
                    [authUser, rail.accountId]
                ).catch(() => null)
                if (!cred) continue
                accountId = rail.accountId
            }

            const cleanItems = rail.items
                .filter(item => item && typeof item.id === 'string' && item.id.length > 0)
                .slice(0, MAX_CATALOG_ITEMS)
                .map(item => ({
                    id: String(item.id).slice(0, 128),
                    type: item.type === 'series' ? 'series' : 'movie',
                    name: typeof item.name === 'string' ? item.name.slice(0, 256) : 'Unknown',
                    poster: typeof item.poster === 'string' ? item.poster.slice(0, 1024) : undefined,
                    score: typeof item.score === 'number' ? item.score : undefined,
                    reason: typeof item.reason === 'string' ? item.reason.slice(0, 256) : undefined,
                }))
                .filter(item => !item.poster || item.poster.startsWith('http'))

            if (cleanItems.length === 0) continue

            pendingWrites.push({
                accountId,
                catalogType: rail.catalogType,
                itemsJson: JSON.stringify(cleanItems)
            })
        }

        let published = 0
        if (pendingWrites.length > 0) {
            try {
                published = await db.tx(async (tx) => {
                    let count = 0
                    for (const w of pendingWrites) {
                        await tx.run(
                            db.type === 'postgres'
                                ? `INSERT INTO recommendation_cache (sync_user, account_id, catalog_type, items, updated_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (sync_user, account_id, catalog_type) DO UPDATE SET items = EXCLUDED.items, updated_at = EXCLUDED.updated_at`
                                : `INSERT INTO recommendation_cache (sync_user, account_id, catalog_type, items, updated_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT(sync_user, account_id, catalog_type) DO UPDATE SET items = excluded.items, updated_at = excluded.updated_at`,
                            [authUser, w.accountId, w.catalogType, w.itemsJson, now]
                        )
                        count++
                    }
                    return count
                })
            } catch {}
        }

        return { success: true, published }
    })

    fastify.post('/api/catalog/watchlist/add', {
        bodyLimit: 4096,
        config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    }, async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }

        const { itemId, type, name, poster, accountId } = request.body || {}
        if (!itemId || typeof itemId !== 'string') {
            reply.status(400); return { error: 'itemId required' }
        }

        const effectiveAccountId = accountId || HOUSEHOLD_ACCOUNT_ID
        const cleanType = type === 'series' ? 'series' : 'movie'
        const cleanName = typeof name === 'string' ? name.slice(0, 256) : null
        const cleanPoster = typeof poster === 'string' && poster.startsWith('http') ? poster.slice(0, 1024) : null
        const now = Date.now()

        try {
            await db.run(
                db.type === 'postgres'
                    ? `INSERT INTO watchlist_items (sync_user, account_id, item_id, item_type, item_name, poster, added_at) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (sync_user, account_id, item_id) DO UPDATE SET item_name = EXCLUDED.item_name, poster = EXCLUDED.poster, added_at = EXCLUDED.added_at`
                    : `INSERT INTO watchlist_items (sync_user, account_id, item_id, item_type, item_name, poster, added_at) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT(sync_user, account_id, item_id) DO UPDATE SET item_name = excluded.item_name, poster = excluded.poster, added_at = excluded.added_at`,
                [authUser, effectiveAccountId, itemId.slice(0, 128), cleanType, cleanName, cleanPoster, now]
            )
            return { success: true }
        } catch {
            return { success: false }
        }
    })

    fastify.delete('/api/catalog/watchlist/remove', {
        bodyLimit: 1024,
    }, async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }

        const { itemId, accountId } = request.body || {}
        if (!itemId) { reply.status(400); return { error: 'itemId required' } }

        const effectiveAccountId = accountId || HOUSEHOLD_ACCOUNT_ID

        try {
            await db.run(
                'DELETE FROM watchlist_items WHERE sync_user = $1 AND account_id = $2 AND item_id = $3',
                [authUser, effectiveAccountId, itemId]
            )
            return { success: true }
        } catch {
            return { success: false }
        }
    })

    fastify.get('/api/catalog/watchlist', async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }

        const accountId = (request.query && request.query.accountId) || HOUSEHOLD_ACCOUNT_ID

        try {
            const rows = await db.query(
                `SELECT item_id, item_type, item_name, poster, added_at FROM watchlist_items
                 WHERE sync_user = $1 AND account_id = $2 ORDER BY added_at DESC`,
                [authUser, accountId]
            )
            return { items: (rows || []).map(r => ({
                itemId: r.item_id,
                type: r.item_type,
                name: r.item_name,
                poster: r.poster,
                addedAt: r.added_at,
            })) }
        } catch {
            return { items: [] }
        }
    })
}
