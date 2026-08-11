import db from '../db.js'
import { decrypt } from '../crypto.js'
import { FALLBACK_KEYS } from '../keys.js'
import { verifyAuth } from '../auth.js'
import { metadataCache, jitteredTtl } from '../lib/metadata-cache.js'
import { maskContext } from '../utils/log-helpers.js'

const TMDB_V3_API_BASE = 'https://api.themoviedb.org/3'
const TMDB_V4_API_BASE = 'https://api.themoviedb.org/4'
const SUPPORTED_PROVIDERS = new Set(['tmdb'])
const DEFAULT_TTL_DETAILS_MS = 24 * 60 * 60 * 1000
const DEFAULT_TTL_LONG_MS = 7 * 24 * 60 * 60 * 1000

const RATE_LIMIT_PROXY = { max: 300, timeWindow: '1 minute' }
const RATE_LIMIT_STATS = { max: 30, timeWindow: '1 minute' }

export function _redactKey(input) {
    if (input == null) return input
    if (typeof input === 'string') {
        return input
            .replace(/api_key=[a-fA-F0-9_-]{16,}/gi, 'api_key=REDACTED')
            .replace(/api_key=[a-zA-Z0-9._-]{16,}/g, 'api_key=REDACTED')
            .replace(/Bearer\s+eyJ[a-zA-Z0-9._-]+/gi, 'Bearer REDACTED')
            .replace(/eyJ[a-zA-Z0-9._-]{20,}/g, 'REDACTED_JWT')
            .replace(/\b[a-fA-F0-9]{32}\b/g, 'REDACTED_HEX32')
    }
    if (typeof input === 'object') {
        try {
            const json = JSON.stringify(input)
            return JSON.parse(_redactKey(json))
        } catch {
            return '[unredactable]'
        }
    }
    try {
        return _redactKey(String(input))
    } catch {
        return '[unredactable]'
    }
}

function normalizeProvider(raw) {
    if (typeof raw !== 'string') return null
    const lower = raw.trim().toLowerCase()
    if (!lower) return null
    if (!SUPPORTED_PROVIDERS.has(lower)) return null
    return lower
}

function buildTmdbRequest(pathParts, query, key, keyFormat) {
    const cleanPath = pathParts
        .filter(Boolean)
        .map(encodeURIComponent)
        .join('/')
    if (keyFormat === 'v4') {
        const url = query
            ? `${TMDB_V3_API_BASE}/${cleanPath}?${query}`
            : `${TMDB_V3_API_BASE}/${cleanPath}`
        return {
            url,
            init: {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${key}`,
                    Accept: 'application/json',
                },
            },
        }
    }
    const url = query
        ? `${TMDB_V3_API_BASE}/${cleanPath}?api_key=${key}&${query}`
        : `${TMDB_V3_API_BASE}/${cleanPath}?api_key=${key}`
    return {
        url,
        init: {
            method: 'GET',
            headers: { Accept: 'application/json' },
        },
    }
}

function classifyTmdbKey(pathParts, query) {
    const resource = (pathParts[0] || '').toLowerCase()
    if (resource === 'find') return { kind: 'find', ttl: 0, permanent: true }
    if (resource === 'trending') return { kind: 'trending', ttl: DEFAULT_TTL_DETAILS_MS }
    if (resource === 'movie' || resource === 'tv') {
        const sub = (pathParts[2] || '').toLowerCase()
        if (sub === 'videos') return { kind: 'videos', ttl: DEFAULT_TTL_LONG_MS }
        if (sub === 'recommendations' || sub === 'similar') return { kind: 'recs', ttl: DEFAULT_TTL_LONG_MS }
        if (!sub) return { kind: 'details', ttl: DEFAULT_TTL_DETAILS_MS }
        return { kind: sub || 'misc', ttl: DEFAULT_TTL_DETAILS_MS }
    }
    return { kind: 'misc', ttl: DEFAULT_TTL_DETAILS_MS }
}

function buildCacheKey(provider, pathParts, query) {
    const resource = (pathParts[0] || '').toLowerCase()
    if (provider === 'tmdb') {
        if (resource === 'find') {
            const imdbMatch = (query || '').match(/external_id=([^&]+)/i)
            const imdbId = imdbMatch ? decodeURIComponent(imdbMatch[1]) : (pathParts[1] || 'unknown')
            return `tmdb:find:${imdbId}`
        }
        if (resource === 'trending') {
            const mediaType = (pathParts[1] || 'all').toLowerCase()
            const window = (pathParts[2] || 'week').toLowerCase()
            return `tmdb:trending:${mediaType}:${window}`
        }
        if (resource === 'movie' || resource === 'tv') {
            const tmdbId = String(pathParts[1] || 'unknown')
            const sub = (pathParts[2] || '').toLowerCase()
            if (sub === 'videos') return `tmdb:videos:${resource}:${tmdbId}`
            if (sub === 'recommendations' || sub === 'similar') return `tmdb:recommendations:${resource}:${tmdbId}`
            if (sub === 'season') return `tmdb:season:${resource}:${tmdbId}:${pathParts[3] || 'unknown'}`
            if (!sub) {
                const appendMatch = (query || '').match(/append_to_response=([^&]+)/i)
                const append = appendMatch ? appendMatch[1] : ''
                return `tmdb:details:${resource}:${tmdbId}:${append}`
            }
            return `tmdb:${sub}:${resource}:${tmdbId}`
        }
    }
    return `${provider}:${resource}:${(pathParts || []).slice(1).join(':') || 'root'}:${query || ''}`
}

async function loadUserKey(userId, provider) {
    const row = await db.get(
        'SELECT encrypted_key, key_format FROM metadata_keys WHERE user_id = $1 AND provider = $2 LIMIT 1',
        [userId, provider]
    )
    if (row && row.encrypted_key) {
        const plaintext = decrypt(row.encrypted_key, FALLBACK_KEYS)
        if (plaintext) {
            let format = row.key_format
            if (format !== 'v3' && format !== 'v4') {
                if (plaintext.startsWith('eyJ')) format = 'v4'
                else if (/^[0-9a-fA-F]{32}$/.test(plaintext)) format = 'v3'
                else format = 'generic'
            }
            return { key: plaintext, format, source: 'user' }
        }
    }
    return null
}

async function fetchUpstream(requestDescriptor, signal) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)
    try {
        if (signal) {
            signal.addEventListener('abort', () => controller.abort(), { once: true })
        }
        const response = await fetch(requestDescriptor.url, {
            ...requestDescriptor.init,
            signal: controller.signal,
        })
        const text = await response.text()
        if (!response.ok) {
            const err = new Error(`upstream status ${response.status}`)
            err.status = response.status
            throw err
        }
        return text
    } finally {
        clearTimeout(timeout)
    }
}

export function registerMetadataProxyRoutes(fastify) {
    metadataCache.startCleanupJob()

    fastify.get('/api/metadata/:provider/*', {
        config: { rateLimit: RATE_LIMIT_PROXY },
    }, async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) {
            reply.status(401); return { error: 'Unauthorized' }
        }

        const provider = normalizeProvider(request.params.provider)
        if (!provider) {
            reply.status(400); return { error: 'Unsupported provider' }
        }

        const wildcard = request.params['*'] || ''
        const pathParts = String(wildcard).split('/').filter(Boolean)
        if (pathParts.length === 0) {
            reply.status(400); return { error: 'Missing resource path' }
        }

        let keyRecord
        try {
            keyRecord = await loadUserKey(authUser, provider)
        } catch (err) {
            fastify.log.error({ category: 'MetadataProxy' }, `Key lookup failed for user ${maskContext(authUser)} provider ${provider}: ${_redactKey(err && err.message)}`)
            reply.status(500); return { error: 'Key lookup failed' }
        }

        if (!keyRecord) {
            reply.status(401); return { error: 'Provider key not configured' }
        }

        const incomingQuery = request.query && typeof request.query === 'object' ? request.query : {}
        const sortedQuery = Object.keys(incomingQuery)
            .sort()
            .filter(k => k && typeof incomingQuery[k] !== 'undefined' && incomingQuery[k] !== null)
            .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(String(incomingQuery[k]))}`)
            .join('&')

        const requestDescriptor = buildTmdbRequest(pathParts, sortedQuery, keyRecord.key, keyRecord.format)
        const classification = classifyTmdbKey(pathParts, sortedQuery)
        const cacheKey = buildCacheKey(provider, pathParts, sortedQuery)

        const options = classification.permanent
            ? { permanent: true }
            : { ttl: classification.ttl }

        let result
        try {
            result = await metadataCache.get(cacheKey, () => fetchUpstream(requestDescriptor), options)
        } catch (err) {
            const status = err && err.status ? err.status : 502
            const safeMessage = err && err.name === 'AbortError'
                ? 'upstream timeout'
                : _redactKey((err && err.message) || 'upstream fetch failed')
            fastify.log.warn({ category: 'MetadataProxy' }, `Fetch failed for ${provider}:${classification.kind} user ${maskContext(authUser)}: ${safeMessage}`)
            reply.status(status >= 400 && status < 600 ? status : 502)
            return { error: safeMessage }
        }

        const value = result && result.value
        if (value && typeof value === 'object' && value._stale === true) {
            const { _stale, ...clean } = value
            return clean
        }
        return value
    })

    fastify.get('/api/admin/cache-stats', {
        config: { rateLimit: RATE_LIMIT_STATS },
    }, async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) {
            reply.status(401); return { error: 'Unauthorized' }
        }
        try {
            const stats = await metadataCache.getStats()
            return stats
        } catch (err) {
            fastify.log.error({ category: 'MetadataProxy' }, `Cache stats failed: ${_redactKey(err && err.message)}`)
            reply.status(500); return { error: 'Failed to compute stats' }
        }
    })

    fastify.get('/api/metadata/test', {
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) {
            reply.status(401); return { error: 'Unauthorized' }
        }

        const provider = (request.query.provider || 'tmdb').toLowerCase()

        let keyRecord
        const unsavedKey = typeof request.query.key === 'string' && request.query.key.trim() ? request.query.key.trim() : null
        if (unsavedKey) {
            const format = unsavedKey.startsWith('eyJ') ? 'v4' : (/^[0-9a-fA-F]{32}$/.test(unsavedKey) ? 'v3' : 'v3')
            keyRecord = { key: unsavedKey, format, source: 'unsaved' }
        } else {
            try {
                keyRecord = await loadUserKey(authUser, provider)
            } catch {
                reply.status(500); return { error: 'Key lookup failed' }
            }
        }

        if (!keyRecord) {
            const envVar = provider === 'tmdb' ? 'TMDB_API_KEY' : `${provider.toUpperCase()}_API_KEY`
            return {
                success: false,
                message: `No ${provider.toUpperCase()} key configured.`,
                source: null,
            }
        }

        if (provider === 'tmdb') {
            const testReq = buildTmdbRequest(['configuration'], '', keyRecord.key, keyRecord.format)
            try {
                const text = await fetchUpstream(testReq)
                const data = JSON.parse(text)
                if (data && data.images) {
                    return {
                        success: true,
                        message: `TMDB API key is working.`,
                        source: keyRecord.source,
                    }
                }
                return { success: false, message: 'TMDB returned an unexpected response.', source: keyRecord.source }
            } catch (err) {
                const status = err?.status
                const reason = status === 401 ? 'Invalid or expired API key' : `TMDB request failed (status ${status || 'unknown'})`
                return { success: false, message: reason, source: keyRecord.source }
            }
        }

        return {
            success: true,
            message: `${provider.toUpperCase()} key stored and ready.`,
            source: keyRecord.source,
        }
    })

    fastify.decorate('metadataCache', metadataCache)

    const PMDB_BASE = 'https://publicmetadb.com/api/external'
    const RATE_LIMIT_PMDB = { max: 300, timeWindow: '1 minute' }

    const auxCache = new Map()
    const AUX_CACHE_TTL_STABLE = 24 * 60 * 60 * 1000
    const AUX_CACHE_TTL_DEFAULT = 6 * 60 * 60 * 1000
    const AUX_CACHE_TTL_VOLATILE = 30 * 60 * 1000
    const AUX_CACHE_TTL_NULL = 60 * 1000
    const AUX_CACHE_MAX = 2000

    function auxCacheGet(key) {
        const entry = auxCache.get(key)
        if (!entry) return null
        if (Date.now() > entry.expiresAt) { auxCache.delete(key); return null }
        auxCache.delete(key); auxCache.set(key, entry)
        return entry.value
    }
    function auxCacheSet(key, value, ttl) {
        if (auxCache.size >= AUX_CACHE_MAX) { const o = auxCache.keys().next().value; if (o) auxCache.delete(o) }
        auxCache.set(key, { value, expiresAt: Date.now() + (ttl || AUX_CACHE_TTL_DEFAULT) })
    }

    fastify.get('/api/metadata/pmdb/*', {
        config: { rateLimit: RATE_LIMIT_PMDB },
    }, async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }

        let keyRecord
        try {
            keyRecord = await loadUserKey(authUser, 'pmdb')
        } catch {
            reply.status(500); return { error: 'Key lookup failed' }
        }
        if (!keyRecord) {
            reply.status(401); return { error: 'PMDB key not configured' }
        }

        const wildcard = request.params['*'] || ''
        const pathParts = String(wildcard).split('/').filter(Boolean)
        if (pathParts.length === 0) {
            reply.status(400); return { error: 'Missing resource path' }
        }

        const cleanPath = pathParts.map(encodeURIComponent).join('/')
        const incomingQuery = request.query && typeof request.query === 'object' ? request.query : {}
        const queryString = Object.keys(incomingQuery)
            .filter(k => k && incomingQuery[k] !== undefined && incomingQuery[k] !== null)
            .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(String(incomingQuery[k]))}`)
            .join('&')

        const url = queryString
            ? `${PMDB_BASE}/${cleanPath}?${queryString}`
            : `${PMDB_BASE}/${cleanPath}`

        const cacheKey = `${authUser}:${url}`
        const cached = auxCacheGet(cacheKey)
        if (cached) {
            reply.header('Content-Type', 'application/json')
            reply.header('X-Cache', 'HIT')
            return cached
        }

        try {
            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), 15000)
            if (request.socket && !request.socket.destroyed) {
                request.socket.on('close', () => controller.abort())
            }
            const response = await fetch(url, {
                headers: {
                    Authorization: `Bearer ${keyRecord.key}`,
                    Accept: 'application/json',
                },
                signal: controller.signal,
            })
            clearTimeout(timeout)
            const text = await response.text()
            if (!response.ok) {
                reply.status(response.status)
                return { error: `PMDB upstream error (${response.status})` }
            }
            auxCacheSet(`${authUser}:${url}`, text)
            reply.header('Content-Type', 'application/json')
            return text
        } catch (err) {
            const status = err?.name === 'AbortError' ? 504 : 502
            reply.status(status)
            return { error: 'PMDB request failed' }
        }
    })

    async function pmdbMutate(request, reply, method) {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }

        let keyRecord
        try { keyRecord = await loadUserKey(authUser, 'pmdb') } catch { reply.status(500); return { error: 'Key lookup failed' } }
        if (!keyRecord) { reply.status(401); return { error: 'PMDB key not configured' } }

        const wildcard = request.params['*'] || ''
        const pathParts = String(wildcard).split('/').filter(Boolean)
        if (pathParts.length === 0) { reply.status(400); return { error: 'Missing resource path' } }

        const cleanPath = pathParts.map(encodeURIComponent).join('/')
        const incomingQuery = request.query && typeof request.query === 'object' ? request.query : {}
        const queryString = Object.keys(incomingQuery)
            .filter(k => k && incomingQuery[k] !== undefined && incomingQuery[k] !== null)
            .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(String(incomingQuery[k]))}`)
            .join('&')

        const url = queryString
            ? `${PMDB_BASE}/${cleanPath}?${queryString}`
            : `${PMDB_BASE}/${cleanPath}`

        try {
            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), 15000)
            if (request.socket && !request.socket.destroyed) {
                request.socket.on('close', () => controller.abort())
            }
            const fetchOptions = {
                method,
                headers: {
                    Authorization: `Bearer ${keyRecord.key}`,
                    Accept: 'application/json',
                },
                signal: controller.signal,
            }
            if (method !== 'DELETE' && request.body !== undefined && request.body !== null) {
                fetchOptions.headers['Content-Type'] = 'application/json'
                fetchOptions.body = typeof request.body === 'string' ? request.body : JSON.stringify(request.body)
            }
            const response = await fetch(url, fetchOptions)
            clearTimeout(timeout)
            const text = await response.text()
            if (!response.ok) {
                reply.status(response.status)
                try { return JSON.parse(text) } catch { return { error: `PMDB upstream error (${response.status})` } }
            }
            reply.header('Content-Type', 'application/json')
            return text || '{}'
        } catch (err) {
            const status = err?.name === 'AbortError' ? 504 : 502
            reply.status(status)
            return { error: 'PMDB request failed' }
        }
    }

    fastify.post('/api/metadata/pmdb/*', {
        config: { rateLimit: RATE_LIMIT_PMDB },
    }, async (request, reply) => pmdbMutate(request, reply, 'POST'))

    fastify.delete('/api/metadata/pmdb/*', {
        config: { rateLimit: RATE_LIMIT_PMDB },
    }, async (request, reply) => pmdbMutate(request, reply, 'DELETE'))

    const MDBLIST_BASE = 'https://mdblist.com/api'
    const TVDB_BASE = 'https://api4.thetvdb.com/v4'

    fastify.get('/api/metadata/mdblist/*', {
        config: { rateLimit: RATE_LIMIT_PROXY },
    }, async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }

        let keyRecord
        try { keyRecord = await loadUserKey(authUser, 'mdblist') } catch { reply.status(500); return { error: 'Key lookup failed' } }
        if (!keyRecord) { reply.status(401); return { error: 'MDBList key not configured' } }

        const wildcard = request.params['*'] || ''
        const pathParts = String(wildcard).split('/').filter(Boolean)
        if (pathParts.length === 0) { reply.status(400); return { error: 'Missing path' } }

        const incomingQuery = request.query && typeof request.query === 'object' ? request.query : {}
        const queryParts = []
        for (const [k, v] of Object.entries(incomingQuery)) {
            if (k && v !== undefined && v !== null) queryParts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        }

        let url
        if (pathParts[0] === 'i' && pathParts[1]) {
            queryParts.push(`i=${encodeURIComponent(pathParts[1])}`)
            queryParts.push(`apikey=${keyRecord.key}`)
            url = `${MDBLIST_BASE}/?${queryParts.join('&')}`
        } else {
            const cleanPath = pathParts.map(encodeURIComponent).join('/')
            queryParts.push(`apikey=${keyRecord.key}`)
            url = `${MDBLIST_BASE}/${cleanPath}?${queryParts.join('&')}`
        }

        const cachedMdb = auxCacheGet(url)
        if (cachedMdb) { reply.header('Content-Type', 'application/json'); reply.header('X-Cache', 'HIT'); return cachedMdb }

        try {
            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), 15000)
            const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
            clearTimeout(timeout)
            const text = await response.text()
            if (!response.ok) { reply.status(response.status); return { error: `MDBList upstream error (${response.status})` } }
            auxCacheSet(url, text)
            reply.header('Content-Type', 'application/json')
            return text
        } catch (err) {
            reply.status(err?.name === 'AbortError' ? 504 : 502)
            return { error: 'MDBList request failed' }
        }
    })

    fastify.get('/api/metadata/tvdb/*', {
        config: { rateLimit: RATE_LIMIT_PROXY },
    }, async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }

        let keyRecord
        try { keyRecord = await loadUserKey(authUser, 'tvdb') } catch { reply.status(500); return { error: 'Key lookup failed' } }
        if (!keyRecord) { reply.status(401); return { error: 'TVDB key not configured' } }

        const wildcard = request.params['*'] || ''
        const pathParts = String(wildcard).split('/').filter(Boolean)
        if (pathParts.length === 0) { reply.status(400); return { error: 'Missing path' } }

        const incomingQuery = request.query && typeof request.query === 'object' ? request.query : {}
        const queryString = Object.keys(incomingQuery)
            .filter(k => k && incomingQuery[k] !== undefined && incomingQuery[k] !== null)
            .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(String(incomingQuery[k]))}`)
            .join('&')
        const cleanPath = pathParts.map(encodeURIComponent).join('/')
        const url = queryString
            ? `${TVDB_BASE}/${cleanPath}?${queryString}`
            : `${TVDB_BASE}/${cleanPath}`

        const cachedTvdb = auxCacheGet(url)
        if (cachedTvdb) { reply.header('Content-Type', 'application/json'); reply.header('X-Cache', 'HIT'); return cachedTvdb }

        try {
            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), 15000)
            const response = await fetch(url, {
                signal: controller.signal,
                headers: { Authorization: `Bearer ${keyRecord.key}`, Accept: 'application/json' },
            })
            clearTimeout(timeout)
            const text = await response.text()
            if (!response.ok) { reply.status(response.status); return { error: `TVDB upstream error (${response.status})` } }
            auxCacheSet(url, text)
            reply.header('Content-Type', 'application/json')
            return text
        } catch (err) {
            reply.status(err?.name === 'AbortError' ? 504 : 502)
            return { error: 'TVDB request failed' }
        }
    })

    const FANART_BASE = 'https://webservice.fanart.tv/v3'

    fastify.get('/api/metadata/fanart/*', {
        config: { rateLimit: RATE_LIMIT_PROXY },
    }, async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }

        let keyRecord
        try { keyRecord = await loadUserKey(authUser, 'fanart') } catch { reply.status(500); return { error: 'Key lookup failed' } }
        if (!keyRecord) { reply.status(401); return { error: 'Fanart key not configured' } }

        const wildcard = request.params['*'] || ''
        const pathParts = String(wildcard).split('/').filter(Boolean)
        if (pathParts.length === 0) { reply.status(400); return { error: 'Missing path' } }

        const cleanPath = pathParts.map(encodeURIComponent).join('/')
        const url = `${FANART_BASE}/${cleanPath}?api_key=${keyRecord.key}`

        const cached = auxCacheGet(url)
        if (cached) { reply.header('Content-Type', 'application/json'); reply.header('X-Cache', 'HIT'); return cached }

        try {
            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), 15000)
            const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
            clearTimeout(timeout)
            const text = await response.text()
            if (!response.ok) { reply.status(response.status); return { error: `Fanart upstream error (${response.status})` } }
            auxCacheSet(url, text)
            reply.header('Content-Type', 'application/json')
            return text
        } catch (err) {
            reply.status(err?.name === 'AbortError' ? 504 : 502)
            return { error: 'Fanart request failed' }
        }
    })

    // ── AUDIENCE REVIEWS & COMMENTS AGGREGATOR ENDPOINT ──────────────────────
    fastify.get('/api/metadata/comments', {
        config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    }, async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) {
            reply.status(401); return { error: 'Unauthorized' }
        }

        const { imdbId, type, tmdbId } = request.query || {}
        if (!imdbId && !tmdbId) return []

        let tmdbKeyRecord = null
        if (authUser) {
            try { tmdbKeyRecord = await loadUserKey(authUser, 'tmdb') } catch {}
        }

        const cacheKey = `comments:${imdbId || tmdbId}:${type || 'movie'}`
        const cached = auxCacheGet(cacheKey)
        if (cached) {
            reply.header('Content-Type', 'application/json')
            return cached
        }

        const comments = []
        const mediaPath = (type === 'series' || type === 'anime' || type === 'tv') ? 'shows' : 'movies'

        // Fetch TMDB Reviews
        const targetTmdbId = tmdbId || (imdbId && !imdbId.startsWith('tt') ? imdbId : null)
        let tmdbNumericId = targetTmdbId

        if (!tmdbNumericId && tmdbKeyRecord && imdbId && imdbId.startsWith('tt')) {
            try {
                const findRes = await fetch(`https://api.themoviedb.org/3/find/${imdbId}?external_source=imdb_id&api_key=${tmdbKeyRecord.key}`)
                if (findRes.ok) {
                    const findData = await findRes.json()
                    const found = (findData.movie_results && findData.movie_results[0]) || (findData.tv_results && findData.tv_results[0])
                    if (found) tmdbNumericId = found.id
                }
            } catch (err) {}
        }

        if (tmdbNumericId && tmdbKeyRecord) {
            try {
                const tmdbType = (type === 'series' || type === 'anime' || type === 'tv') ? 'tv' : 'movie'
                const tmdbRes = await fetch(`https://api.themoviedb.org/3/${tmdbType}/${tmdbNumericId}/reviews?api_key=${tmdbKeyRecord.key}`)
                if (tmdbRes.ok) {
                    const tmdbData = await tmdbRes.json()
                    if (Array.isArray(tmdbData.results)) {
                        for (const rv of tmdbData.results.slice(0, 20)) {
                            if (rv.content && rv.content.trim()) {
                                let avatar = rv.author_details?.avatar_path || undefined
                                if (avatar && avatar.startsWith('/https')) avatar = avatar.slice(1)
                                else if (avatar && avatar.startsWith('/')) avatar = `https://image.tmdb.org/t/p/w185${avatar}`

                                comments.push({
                                    id: `tmdb-${rv.id}`,
                                    author: rv.author || rv.author_details?.username || 'TMDB Reviewer',
                                    avatar,
                                    rating: typeof rv.author_details?.rating === 'number' ? rv.author_details.rating : undefined,
                                    content: rv.content.trim(),
                                    createdAt: rv.created_at || '',
                                    source: 'TMDB',
                                })
                            }
                        }
                    }
                }
            } catch (err) {}
        }

        const json = JSON.stringify(comments)
        auxCacheSet(cacheKey, json)
        reply.header('Content-Type', 'application/json')
        return json
    })
}
