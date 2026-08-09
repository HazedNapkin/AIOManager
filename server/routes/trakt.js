import crypto from 'crypto'
import db from '../db.js'
import { verifyAuth } from '../auth.js'
import { encrypt, decrypt } from '../crypto.js'
import { PRIMARY_KEY, FALLBACK_KEYS } from '../keys.js'

const TRAKT_CLIENT_ID = process.env.TRAKT_CLIENT_ID || ''
const TRAKT_CLIENT_SECRET = process.env.TRAKT_CLIENT_SECRET || ''
const TRAKT_API_BASE = 'https://api.trakt.tv'
const TRAKT_TOKEN_URL = 'https://api.trakt.tv/oauth/token'
const TRAKT_REDIRECT_PATH = '/api/auth/trakt/callback'

function getRedirectUri(request) {
    if (process.env.TRAKT_REDIRECT_URI) return process.env.TRAKT_REDIRECT_URI
    const proto = request.headers['x-forwarded-proto'] || request.protocol || 'https'
    const host = request.headers['x-forwarded-host'] || request.headers.host || 'localhost'
    return `${proto}://${host}${TRAKT_REDIRECT_PATH}`
}

function getBaseAppUrl(request) {
    const proto = request.headers['x-forwarded-proto'] || request.protocol || 'https'
    const host = request.headers['x-forwarded-host'] || request.headers.host || 'localhost'
    return `${proto}://${host}`
}

async function getTraktTokens(syncUser) {
    try {
        const row = await db.get(
            'SELECT value FROM kv_store WHERE key = $1',
            [`trakt_tokens:${syncUser}`]
        )
        if (!row?.value) return null
        const decrypted = decrypt(row.value, FALLBACK_KEYS)
        if (!decrypted) return null
        return JSON.parse(decrypted)
    } catch {
        return null
    }
}

async function saveTraktTokens(syncUser, tokens) {
    const encrypted = encrypt(JSON.stringify(tokens), PRIMARY_KEY)
    const now = Date.now()
    const upsertSql = db.type === 'postgres'
        ? `INSERT INTO kv_store (key, value, updated_at) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`
        : `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES ($1, $2, $3)`
    await db.run(upsertSql, [`trakt_tokens:${syncUser}`, encrypted, now])
}

async function deleteTraktTokens(syncUser) {
    await db.run('DELETE FROM kv_store WHERE key = $1', [`trakt_tokens:${syncUser}`])
}

async function refreshTraktToken(syncUser, refreshToken) {
    const res = await fetch(TRAKT_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'AIOManager/2.0 (+https://github.com/sonicx161/aiomanager)' },
        body: JSON.stringify({
            refresh_token: refreshToken,
            client_id: TRAKT_CLIENT_ID,
            client_secret: TRAKT_CLIENT_SECRET,
            grant_type: 'refresh_token',
        }),
    })
    if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`Trakt token refresh failed (${res.status}): ${body}`)
    }
    const data = await res.json()
    const tokens = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: Date.now() + (data.expires_in * 1000),
        scope: data.scope,
        token_type: data.token_type,
    }
    await saveTraktTokens(syncUser, tokens)
    return tokens
}

async function ensureValidToken(syncUser) {
    let tokens = await getTraktTokens(syncUser)
    if (!tokens) return null
    if (Date.now() > (tokens.expires_at - 60000)) {
        try {
            tokens = await refreshTraktToken(syncUser, tokens.refresh_token)
        } catch {
            await deleteTraktTokens(syncUser)
            return null
        }
    }
    return tokens
}

async function traktApiCall(tokens, path, signal) {
    const res = await fetch(`${TRAKT_API_BASE}${path}`, {
        headers: {
            'Authorization': `Bearer ${tokens.access_token}`,
            'Content-Type': 'application/json',
            'trakt-api-version': '2',
            'trakt-api-key': TRAKT_CLIENT_ID,
        },
        signal,
    })
    if (res.status === 401) throw new Error('Trakt token expired')
    if (!res.ok) throw new Error(`Trakt API error (${res.status})`)
    return res.json()
}

const oauthStates = new Map()

export function registerTraktRoutes(fastify) {

    fastify.get('/api/auth/trakt/start', {
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    }, async (request, reply) => {
        if (!TRAKT_CLIENT_ID || !TRAKT_CLIENT_SECRET) {
            reply.status(503)
            return { error: 'Trakt OAuth is not configured on this instance. Set TRAKT_CLIENT_ID and TRAKT_CLIENT_SECRET in .env' }
        }

        const authUser = await verifyAuth(request)
        if (!authUser) {
            reply.status(401)
            return { error: 'Unauthorized' }
        }

        const codeVerifier = crypto.randomBytes(32).toString('hex')
        const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')
        const state = crypto.randomBytes(32).toString('hex')

        oauthStates.set(state, {
            syncUser: authUser,
            codeVerifier,
            createdAt: Date.now(),
        })
        setTimeout(() => oauthStates.delete(state), 600000)

        const redirectUri = getRedirectUri(request)
        const authUrl = new URL('https://trakt.tv/oauth/authorize')
        authUrl.searchParams.set('response_type', 'code')
        authUrl.searchParams.set('client_id', TRAKT_CLIENT_ID)
        authUrl.searchParams.set('redirect_uri', redirectUri)
        authUrl.searchParams.set('state', state)
        authUrl.searchParams.set('scope', 'public offline_access')

        return { url: authUrl.toString(), state }
    })

    fastify.get('/api/auth/trakt/callback', {
        config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    }, async (request, reply) => {
        const { code, state, error } = request.query

        if (error) {
            reply.header('Content-Type', 'text/html')
            return `<script>window.close();</script><p>Authorization cancelled: ${error}</p>`
        }

        if (!code || !state) {
            reply.status(400)
            return { error: 'Missing code or state parameter' }
        }

        const stateData = oauthStates.get(state)
        if (!stateData) {
            reply.status(400)
            return { error: 'Invalid or expired state' }
        }
        oauthStates.delete(state)

        if (Date.now() - stateData.createdAt > 600000) {
            reply.status(400)
            return { error: 'Authorization timed out' }
        }

        try {
            const redirectUri = getRedirectUri(request)
            const tokenRes = await fetch(TRAKT_TOKEN_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'User-Agent': 'AIOManager/2.0 (+https://github.com/sonicx161/aiomanager)' },
                body: JSON.stringify({
                    code,
                    client_id: TRAKT_CLIENT_ID,
                    client_secret: TRAKT_CLIENT_SECRET,
                    redirect_uri: redirectUri,
                    grant_type: 'authorization_code',
                }),
            })

            if (!tokenRes.ok) {
                const body = await tokenRes.text().catch(() => '')
                reply.status(400)
                return { error: `Token exchange failed (${tokenRes.status}): ${body}` }
            }

            const tokenData = await tokenRes.json()
            const tokens = {
                access_token: tokenData.access_token,
                refresh_token: tokenData.refresh_token,
                expires_at: Date.now() + (tokenData.expires_in * 1000),
                scope: tokenData.scope,
                token_type: tokenData.token_type,
                created_at: tokenData.created_at,
            }
            await saveTraktTokens(stateData.syncUser, tokens)

            reply.header('Content-Type', 'text/html')
            return `<script>window.opener?.postMessage({ type: 'trakt-connected', success: true }, '*'); window.close();</script><p>Trakt connected successfully!</p>`
        } catch (err) {
            reply.status(500)
            return { error: `OAuth callback failed: ${err.message}` }
        }
    })

    fastify.get('/api/trakt/status', async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }

        const tokens = await getTraktTokens(authUser)
        return {
            connected: !!tokens,
            configured: !!(TRAKT_CLIENT_ID && TRAKT_CLIENT_SECRET),
        }
    })

    fastify.delete('/api/trakt/disconnect', async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }

        await deleteTraktTokens(authUser)
        return { success: true }
    })

    fastify.get('/api/trakt/sync', {
        config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
        bodyLimit: 1024 * 1024 * 5,
    }, async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }

        const tokens = await ensureValidToken(authUser)
        if (!tokens) {
            reply.status(401)
            return { error: 'Trakt not connected or token expired' }
        }

        try {
            const signal = AbortSignal.timeout(30000)

            const [watchedMovies, watchedShows, ratingsMovies, ratingsShows, watchlistMovies, watchlistShows] = await Promise.all([
                traktApiCall(tokens, '/sync/history/movies?limit=1000', signal).catch(() => []),
                traktApiCall(tokens, '/sync/history/shows?limit=1000', signal).catch(() => []),
                traktApiCall(tokens, '/sync/ratings/movies', signal).catch(() => []),
                traktApiCall(tokens, '/sync/ratings/shows', signal).catch(() => []),
                traktApiCall(tokens, '/sync/watchlist/movies', signal).catch(() => []),
                traktApiCall(tokens, '/sync/watchlist/shows', signal).catch(() => []),
            ])

            const normalizeItem = (item) => {
                const movie = item.movie || item.show
                if (!movie) return null
                return {
                    imdbId: movie.ids?.imdb || null,
                    tmdbId: movie.ids?.tmdb || null,
                    tvdbId: movie.ids?.tvdb || null,
                    title: movie.title || movie.name || 'Unknown',
                    year: movie.year || null,
                    type: item.movie ? 'movie' : 'series',
                }
            }

            const watched = [
                ...(Array.isArray(watchedMovies) ? watchedMovies.map(normalizeItem) : []),
                ...(Array.isArray(watchedShows) ? watchedShows.map(normalizeItem) : []),
            ].filter(Boolean)

            const ratings = [
                ...(Array.isArray(ratingsMovies) ? ratingsMovies.map(r => ({ ...normalizeItem(r), rating: r.rating, ratedAt: r.rated_at })) : []),
                ...(Array.isArray(ratingsShows) ? ratingsShows.map(r => ({ ...normalizeItem(r), rating: r.rating, ratedAt: r.rated_at })) : []),
            ].filter(Boolean)

            const watchlist = [
                ...(Array.isArray(watchlistMovies) ? watchlistMovies.map(normalizeItem) : []),
                ...(Array.isArray(watchlistShows) ? watchlistShows.map(normalizeItem) : []),
            ].filter(Boolean)

            const expiresInDays = tokens.expires_at ? Math.floor((tokens.expires_at - Date.now()) / 86400000) : null

            return {
                success: true,
                stats: {
                    watched: watched.length,
                    rated: ratings.length,
                    watchlist: watchlist.length,
                },
                expiresInDays,
                data: { watched, ratings, watchlist },
            }
        } catch (err) {
            reply.status(502)
            return { error: `Trakt sync failed: ${err.message}` }
        }
    })

    fastify.get('/api/trakt/recommendations/:type', {
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    }, async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }
        const tokens = await ensureValidToken(authUser)
        if (!tokens) { reply.status(401); return { error: 'Trakt not connected' } }
        const { type } = request.params
        const mediaType = type === 'movie' ? 'movies' : 'shows'
        try {
            const signal = AbortSignal.timeout(15000)
            const data = await traktApiCall(tokens, `/recommendations/${mediaType}?limit=100&ignore_watched=true`, signal)
            if (!Array.isArray(data)) return []
            return data.slice(0, 50).map(item => {
                const media = item.movie || item.show
                if (!media) return null
                return {
                    imdbId: media.ids?.imdb || null,
                    tmdbId: media.ids?.tmdb || null,
                    title: media.title || media.name || 'Unknown',
                    year: media.year || null,
                    type: item.movie ? 'movie' : 'series',
                }
            }).filter(Boolean)
        } catch { return [] }
    })

    fastify.get('/api/trakt/last_activities', async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }
        const tokens = await ensureValidToken(authUser)
        if (!tokens) { reply.status(401); return { error: 'Trakt not connected' } }
        try {
            const signal = AbortSignal.timeout(10000)
            return await traktApiCall(tokens, '/sync/last_activities', signal)
        } catch { return { movies: {}, shows: {}, episodes: {} } }
    })

    fastify.get('/api/trakt/trending/:type', {
        config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    }, async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }
        const { type } = request.params
        const mediaType = type === 'movie' ? 'movies' : 'shows'
        try {
            const tokens = await ensureValidToken(authUser)
            if (!tokens) return []
            const signal = AbortSignal.timeout(10000)
            const data = await traktApiCall(tokens, `/${mediaType}/trending?limit=20`, signal)
            if (!Array.isArray(data)) return []
            return data.slice(0, 20).map(item => {
                const media = item.movie || item.show
                if (!media) return null
                return {
                    imdbId: media.ids?.imdb || null,
                    tmdbId: media.ids?.tmdb || null,
                    title: media.title || 'Unknown',
                    year: media.year || null,
                    type: item.movie ? 'movie' : 'series',
                    watchers: item.watchers || 0,
                }
            }).filter(Boolean)
        } catch { return [] }
    })

    fastify.get('/api/trakt/comments/:type/:id', {
        config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    }, async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }

        const { type, id } = request.params
        const mediaType = type === 'movie' ? 'movies' : 'shows'

        try {
            const signal = AbortSignal.timeout(10000)
            const res = await fetch(`${TRAKT_API_BASE}/comments/item/${mediaType}/${encodeURIComponent(id)}?limit=20`, {
                headers: {
                    'Content-Type': 'application/json',
                    'trakt-api-version': '2',
                    'trakt-api-key': TRAKT_CLIENT_ID,
                },
                signal,
            })
            if (!res.ok) return []
            const data = await res.json()
            if (!Array.isArray(data)) return []

            return data.slice(0, 15).map(item => ({
                id: `trakt-${item.id}`,
                author: item.user?.ids?.slug || item.user?.name || 'Anonymous',
                content: item.comment || '',
                rating: item.user_stats?.rating || (item.rating || null),
                createdAt: item.created_at,
                likes: item.likes || 0,
                replies: item.replies || 0,
                source: 'Trakt',
            }))
        } catch {
            return []
        }
    })
}
