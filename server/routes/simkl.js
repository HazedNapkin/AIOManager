import crypto from 'crypto'
import db from '../db.js'
import { verifyAuth } from '../auth.js'
import { encrypt, decrypt } from '../crypto.js'
import { PRIMARY_KEY, FALLBACK_KEYS } from '../keys.js'

const SIMKL_CLIENT_ID = process.env.SIMKL_CLIENT_ID || ''
const SIMKL_CLIENT_SECRET = process.env.SIMKL_CLIENT_SECRET || ''
const SIMKL_API_BASE = 'https://api.simkl.com'
const SIMKL_OAUTH_BASE = 'https://simkl.com/oauth'
const SIMKL_REDIRECT_PATH = '/api/auth/simkl/callback'

function getRedirectUri(request) {
    if (process.env.SIMKL_REDIRECT_URI) return process.env.SIMKL_REDIRECT_URI
    const proto = request.headers['x-forwarded-proto'] || request.protocol || 'https'
    const host = request.headers['x-forwarded-host'] || request.headers.host || 'localhost'
    return `${proto}://${host}${SIMKL_REDIRECT_PATH}`
}

async function getSimklTokens(syncUser) {
    try {
        const row = await db.get(
            'SELECT value FROM kv_store WHERE key = $1',
            [`simkl_tokens:${syncUser}`]
        )
        if (!row?.value) return null
        const decrypted = decrypt(row.value, FALLBACK_KEYS)
        if (!decrypted) return null
        return JSON.parse(decrypted)
    } catch {
        return null
    }
}

async function saveSimklTokens(syncUser, tokens) {
    const encrypted = encrypt(JSON.stringify(tokens), PRIMARY_KEY)
    const now = Date.now()
    const upsertSql = db.type === 'postgres'
        ? `INSERT INTO kv_store (key, value, updated_at) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`
        : `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES ($1, $2, $3)`
    await db.run(upsertSql, [`simkl_tokens:${syncUser}`, encrypted, now])
}

async function deleteSimklTokens(syncUser) {
    await db.run('DELETE FROM kv_store WHERE key = $1', [`simkl_tokens:${syncUser}`])
}

async function simklApiCall(tokens, path, signal) {
    const url = new URL(`${SIMKL_API_BASE}${path}`)
    url.searchParams.set('client_id', SIMKL_CLIENT_ID)
    const res = await fetch(url.toString(), {
        headers: {
            'Authorization': `Bearer ${tokens.access_token}`,
            'Content-Type': 'application/json',
        },
        signal,
    })
    if (res.status === 401) throw new Error('Simkl token invalid')
    if (!res.ok) throw new Error(`Simkl API error (${res.status})`)
    return res.json()
}

const oauthStates = new Map()

export function registerSimklRoutes(fastify) {

    fastify.get('/api/auth/simkl/start', {
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    }, async (request, reply) => {
        if (!SIMKL_CLIENT_ID || !SIMKL_CLIENT_SECRET) {
            reply.status(503)
            return { error: 'Simkl OAuth is not configured on this instance. Set SIMKL_CLIENT_ID and SIMKL_CLIENT_SECRET in .env' }
        }

        const authUser = await verifyAuth(request)
        if (!authUser) {
            reply.status(401)
            return { error: 'Unauthorized' }
        }

        const state = crypto.randomBytes(32).toString('hex')

        oauthStates.set(state, {
            syncUser: authUser,
            createdAt: Date.now(),
        })
        setTimeout(() => oauthStates.delete(state), 600000)

        const redirectUri = getRedirectUri(request)
        const authUrl = new URL(`${SIMKL_OAUTH_BASE}/authorize`)
        authUrl.searchParams.set('client_id', SIMKL_CLIENT_ID)
        authUrl.searchParams.set('redirect_uri', redirectUri)
        authUrl.searchParams.set('response_type', 'code')
        authUrl.searchParams.set('state', state)

        return { url: authUrl.toString(), state }
    })

    fastify.get('/api/auth/simkl/callback', {
        config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    }, async (request, reply) => {
        const { code, state, error } = request.query

        if (error) {
            reply.header('Content-Type', 'text/html')
            return `<script>window.opener?.postMessage({ type: 'simkl-connected', success: false, error: 'Cancelled' }, '*'); window.close();</script>`
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
            const tokenRes = await fetch(`${SIMKL_OAUTH_BASE}/token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                },
                body: new URLSearchParams({
                    code,
                    client_id: SIMKL_CLIENT_ID,
                    client_secret: SIMKL_CLIENT_SECRET,
                    redirect_uri: redirectUri,
                    grant_type: 'authorization_code',
                }),
            })

            if (!tokenRes.ok) {
                const body = await tokenRes.text().catch(() => '')
                const isCloudflare = body.includes('cloudflare') || body.includes('challenge') || body.includes('Just a moment')
                reply.header('Content-Type', 'text/html')
                if (isCloudflare) {
                    return `<script>window.opener?.postMessage({ type: 'simkl-connected', success: false, error: 'Simkl OAuth is protected by Cloudflare which blocks server-side token exchange. Use Manual Token option in Settings.' }, '*'); window.close();</script><p style="font-family:sans-serif;padding:2rem">Cloudflare blocked the token exchange. Please use the Manual Token option in AIOManager Settings to paste your Simkl token.</p>`
                }
                reply.status(400)
                return { error: `Token exchange failed (${tokenRes.status})` }
            }

            const tokenData = await tokenRes.json()
            const tokens = {
                access_token: tokenData.access_token,
                token_type: tokenData.token_type,
                scope: tokenData.scope,
            }
            await saveSimklTokens(stateData.syncUser, tokens)

            reply.header('Content-Type', 'text/html')
            return `<script>window.opener?.postMessage({ type: 'simkl-connected', success: true }, '*'); window.close();</script><p>Simkl connected successfully!</p>`
        } catch (err) {
            reply.status(500)
            return { error: `OAuth callback failed: ${err.message}` }
        }
    })

    fastify.post('/api/auth/simkl/manual-token', {
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
        bodyLimit: 1024 * 4,
    }, async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }

        const { access_token } = request.body || {}
        if (!access_token || typeof access_token !== 'string' || access_token.trim().length < 10) {
            reply.status(400)
            return { error: 'Invalid token' }
        }

        try {
            await saveSimklTokens(authUser, { access_token: access_token.trim(), token_type: 'Bearer', scope: 'public' })
            return { success: true }
        } catch (err) {
            reply.status(500)
            return { error: `Failed to store token: ${err.message}` }
        }
    })

    fastify.get('/api/simkl/status', async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }

        const tokens = await getSimklTokens(authUser)
        return {
            connected: !!tokens,
            configured: !!(SIMKL_CLIENT_ID && SIMKL_CLIENT_SECRET),
        }
    })

    fastify.delete('/api/simkl/disconnect', async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }

        await deleteSimklTokens(authUser)
        return { success: true }
    })

    fastify.get('/api/simkl/sync', {
        config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
        bodyLimit: 1024 * 1024 * 5,
    }, async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }

        const tokens = await getSimklTokens(authUser)
        if (!tokens) {
            reply.status(401)
            return { error: 'Simkl not connected' }
        }

        try {
            const signal = AbortSignal.timeout(30000)

            const [allMovies, allShows, allAnime] = await Promise.all([
                simklApiCall(tokens, '/sync/all-items/movies', signal).catch(() => ({ items: [] })),
                simklApiCall(tokens, '/sync/all-items/shows', signal).catch(() => ({ items: [] })),
                simklApiCall(tokens, '/sync/all-items/anime', signal).catch(() => ({ items: [] })),
            ])

            const normalizeMovie = (m) => ({
                imdbId: m.movie?.ids?.imdb || null,
                tmdbId: m.movie?.ids?.tmdb || null,
                tvdbId: null,
                title: m.movie?.title || 'Unknown',
                year: m.movie?.year || null,
                type: 'movie',
            })

            const normalizeShow = (s) => ({
                imdbId: s.show?.ids?.imdb || null,
                tmdbId: s.show?.ids?.tmdb || null,
                tvdbId: s.show?.ids?.tvdb || null,
                title: s.show?.title || 'Unknown',
                year: s.show?.year || null,
                type: 'series',
            })

            const normalizeAnime = (a) => ({
                imdbId: a.anime?.ids?.imdb || null,
                tmdbId: a.anime?.ids?.tmdb || null,
                tvdbId: a.anime?.ids?.tvdb || null,
                title: a.anime?.title || 'Unknown',
                year: a.anime?.year || null,
                type: 'series',
            })

            const movieItems = Array.isArray(allMovies?.items) ? allMovies.items : []
            const showItems = Array.isArray(allShows?.items) ? allShows.items : []
            const animeItems = Array.isArray(allAnime?.items) ? allAnime.items : []

            const watched = []
            const ratings = []
            const watchlist = []

            for (const m of movieItems) {
                const base = normalizeMovie(m)
                const status = m.status || ''
                if (status === 'completed' || status === 'watching' || m.watched_at || m.last_watched_at) {
                    watched.push(base)
                }
                if (status === 'plantowatch') {
                    watchlist.push(base)
                }
                if (m.user_rating) {
                    ratings.push({ ...base, rating: m.user_rating, ratedAt: m.last_watched_at || m.updated_at || '' })
                }
            }

            for (const s of showItems) {
                const base = normalizeShow(s)
                const status = s.status || ''
                if (status === 'completed' || status === 'watching' || s.last_watched_at) {
                    watched.push(base)
                }
                if (status === 'plantowatch') {
                    watchlist.push(base)
                }
                if (s.user_rating) {
                    ratings.push({ ...base, rating: s.user_rating, ratedAt: s.last_watched_at || s.updated_at || '' })
                }
            }

            for (const a of animeItems) {
                const base = normalizeAnime(a)
                const status = a.status || ''
                if (status === 'completed' || status === 'watching' || a.last_watched_at) {
                    watched.push(base)
                }
                if (status === 'plantowatch') {
                    watchlist.push(base)
                }
                if (a.user_rating) {
                    ratings.push({ ...base, rating: a.user_rating, ratedAt: a.last_watched_at || a.updated_at || '' })
                }
            }

            return {
                success: true,
                stats: {
                    watched: watched.length,
                    rated: ratings.length,
                    watchlist: watchlist.length,
                },
                data: { watched, ratings, watchlist },
            }
        } catch (err) {
            reply.status(502)
            return { error: `Simkl sync failed: ${err.message}` }
        }
    })

    fastify.get('/api/simkl/ratings', {
        config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    }, async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }
        const tokens = await getSimklTokens(authUser)
        if (!tokens) { reply.status(401); return { error: 'Simkl not connected' } }
        try {
            const signal = AbortSignal.timeout(30000)
            const data = await simklApiCall(tokens, '/ratings/all?user_watchlist=1&fields=simkl,ext,rank,year', signal)
            if (!data) return []
            return data
        } catch { return [] }
    })

    fastify.get('/api/simkl/activities', async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }
        const tokens = await getSimklTokens(authUser)
        if (!tokens) { reply.status(401); return { error: 'Simkl not connected' } }
        try {
            const signal = AbortSignal.timeout(10000)
            return await simklApiCall(tokens, '/sync/activities', signal)
        } catch { return {} }
    })

    fastify.get('/api/simkl/trending/:type', {
        config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    }, async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }
        const { type } = request.params
        const validTypes = ['movies', 'tv', 'anime']
        if (!validTypes.includes(type)) {
            reply.status(400); return { error: 'Invalid type' }
        }
        try {
            const signal = AbortSignal.timeout(10000)
            const res = await fetch(`https://data.simkl.in/discover/trending/${type}/today_100.json`, { signal })
            if (!res.ok) return []
            const data = await res.json()
            if (!Array.isArray(data)) return []
            return data.slice(0, 20).map(item => ({
                title: item.title || 'Unknown',
                year: item.year || null,
                poster: item.poster || null,
                simklId: item.simkl_id || null,
                type: type === 'movies' ? 'movie' : 'series',
                watchers: item.watched_count || 0,
                rank: item.rank || 0,
            }))
        } catch { return [] }
    })

    fastify.get('/api/simkl/comments/:type/:id', {
        config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    }, async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }

        const { type, id } = request.params

        try {
            const signal = AbortSignal.timeout(10000)
            const url = new URL(`${SIMKL_API_BASE}/comments/${type}/${encodeURIComponent(id)}`)
            url.searchParams.set('client_id', SIMKL_CLIENT_ID)

            const res = await fetch(url.toString(), { signal })
            if (!res.ok) return []
            const data = await res.json()
            if (!Array.isArray(data)) return []

            return data.slice(0, 15).map(item => ({
                id: `simkl-${item.id}`,
                author: item.user?.name || 'Anonymous',
                content: item.comment || '',
                rating: item.rating || null,
                createdAt: item.created_at,
                likes: 0,
                replies: 0,
                source: 'Simkl',
            }))
        } catch {
            return []
        }
    })
}
