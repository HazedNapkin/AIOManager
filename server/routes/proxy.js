import { createHash } from 'node:crypto'
import { AIOSTREAMS_USER_API_THROTTLE_MS, IMAGE_CACHE_MAX_BYTES, IMAGE_CACHE_MAX_ITEM_BYTES, IMAGE_CACHE_TTL_MS, IMAGE_PROXY_QUEUE_LIMIT, IMAGE_PROXY_THROTTLE_MS, IMAGE_PROXY_TIMEOUT_MS, VERSION } from '../config.js'
import { requireProxyAuth, verifyAuth } from '../auth.js'
import { enqueueProxyRequest } from '../proxy-queue.js'
import { isSafeUrlResolved } from '../utils/ssrf.js'
import { deriveAddonName, maskContext, truncateUrl } from '../utils/log-helpers.js'
import { trace, keyTag } from '../utils/trace.js'
import { getAddonUrlKey } from '../utils/addon-url.js'

const briefAddons = (addons) => (Array.isArray(addons) ? addons.map(a => ({ id: a?.manifest?.id || a?.id || '?', url: truncateUrl(a?.transportUrl || '') })) : [])

const SHRINK_GUARD_RATIO = 0.25
const isSuspiciousShrink = (previousCount, nextCount) => (
    previousCount > 0 && nextCount < Math.ceil(previousCount * SHRINK_GUARD_RATIO)
)
export { isSuspiciousShrink }

export function registerProxyRoutes(fastify, { checkAddonHealthInternal }) {
    const manifestCache = new Map()
    const MANIFEST_CACHE_TTL = 600000 // 10 minutes

    const imageCache = new Map()
    const imageInflight = new Map()
    let imageCacheBytes = 0

    const normalizeImageKey = (rawUrl) => {
        try {
            const u = new URL(rawUrl)
            if (u.hostname === 'live.metahub.space' || u.hostname === 'images.metahub.space') {
                u.hostname = 'images.metahub.space'
            }
            return u.href
        } catch {
            return rawUrl
        }
    }

    const imageCacheGet = (key) => {
        const hit = imageCache.get(key)
        if (!hit) return null
        if (hit.expires <= Date.now()) {
            imageCache.delete(key)
            imageCacheBytes -= hit.bytes
            return null
        }
        imageCache.delete(key)
        imageCache.set(key, hit)
        return hit
    }

    const imageCacheSet = (key, buffer, contentType) => {
        if (IMAGE_CACHE_MAX_BYTES <= 0 || buffer.length > IMAGE_CACHE_MAX_ITEM_BYTES) return
        const existing = imageCache.get(key)
        if (existing) { imageCache.delete(key); imageCacheBytes -= existing.bytes }
        const entry = { buffer, contentType, expires: Date.now() + IMAGE_CACHE_TTL_MS, bytes: buffer.length }
        imageCache.set(key, entry)
        imageCacheBytes += entry.bytes
        while (imageCacheBytes > IMAGE_CACHE_MAX_BYTES && imageCache.size > 0) {
            const oldestKey = imageCache.keys().next().value
            const oldest = imageCache.get(oldestKey)
            imageCache.delete(oldestKey)
            imageCacheBytes -= oldest.bytes
        }
    }
    const lastGoodAddonCollections = new Map()
    const MAX_TRACKED_COLLECTIONS = 2500
    const MAX_ADDON_COLLECTION_SIZE = 250
    const PROFILE_SWAP_CONTEXT = 'Profile Swap'
    const ADDON_REFRESH_ERROR_PATTERN = /AddonsPulledFromAPI|UserAddonsLocked|manifest.*missing field|upstream returned 403|forbidden|access denied|status\s*403|\b403\b/i

    const getAIOStreamsAuthHeader = (uuid, password) => `Basic ${Buffer.from(`${uuid}:${password}`, 'utf8').toString('base64')}`

    const readAIOStreamsJson = async (response) => {
        try {
            return await response.json()
        } catch {
            return { success: false, error: { message: 'AIOStreams returned an invalid response' } }
        }
    }

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

    const getRetryAfterMs = (response) => {
        const retryAfter = response.headers.get('retry-after')
        if (!retryAfter) return null
        const seconds = Number(retryAfter)
        if (Number.isFinite(seconds)) return Math.max(0, Math.min(seconds * 1000, 30000))
        const retryDate = Date.parse(retryAfter)
        if (Number.isNaN(retryDate)) return null
        return Math.max(0, Math.min(retryDate - Date.now(), 30000))
    }

    const getAIOStreamsQueueOptions = (url) => {
        let origin = url
        try { origin = new URL(url).origin } catch { }
        return {
            queueKey: `aiostreams-user:${origin}`,
            throttleMs: AIOSTREAMS_USER_API_THROTTLE_MS,
        }
    }

    const fetchAIOStreamsJson = async (url, options = {}) => {
        const { rateLimitRetries = 2, ...fetchOptions } = options
        for (let attempt = 0; attempt <= rateLimitRetries; attempt++) {
            const response = await enqueueProxyRequest(url, async () => {
                const controller = new AbortController()
                const timeout = setTimeout(() => controller.abort(), 10000)
                try {
                    return await fetch(url, {
                        ...fetchOptions,
                        signal: controller.signal,
                        redirect: 'manual',
                    })
                } finally {
                    clearTimeout(timeout)
                }
            }, getAIOStreamsQueueOptions(url))
            const json = await readAIOStreamsJson(response)

            if (response.status !== 429 || attempt >= rateLimitRetries) {
                return { response, json }
            }

            const retryMs = getRetryAfterMs(response) ?? (2500 * (attempt + 1))
            fastify.log.warn({ category: 'AIOStreamsProxy' }, `AIOStreams rate limited ${truncateUrl(url)}; retrying in ${retryMs}ms.`)
            await sleep(retryMs)
        }
    }

    const sanitizeAddonForStremio = (addon) => {
        const manifest = addon?.manifest || {}
        return {
            ...addon,
            manifest: {
                ...manifest,
                id: manifest.id || 'unknown',
                name: manifest.name || deriveAddonName(addon?.transportUrl || ''),
                version: manifest.version || '0.0.0',
                description: manifest.description || '',
                types: Array.isArray(manifest.types) ? manifest.types : [],
                resources: Array.isArray(manifest.resources) ? manifest.resources : []
            }
        }
    }
    const hasKeys = (value) => value && Object.keys(value).length > 0
    const withoutUndefined = (value) => Object.fromEntries(
        Object.entries(value || {}).filter(([, entry]) => entry !== undefined)
    )

    const mergeDuplicateAddon = (existing, incoming) => {
        const flags = {
            ...(incoming.flags || {}),
            ...(existing.flags || {}),
        }
        const metadata = {
            ...withoutUndefined(existing.metadata),
            ...withoutUndefined(incoming.metadata),
        }
        return {
            ...existing,
            ...incoming,
            transportUrl: incoming.transportUrl || existing.transportUrl,
            manifest: incoming.manifest || existing.manifest,
            flags: hasKeys(flags) ? flags : undefined,
            metadata: hasKeys(metadata) ? metadata : undefined,
            catalogOverrides: incoming.catalogOverrides || existing.catalogOverrides,
            note: incoming.note ?? existing.note,
            syncToLibrary: incoming.syncToLibrary ?? existing.syncToLibrary,
        }
    }

    const dedupeAddonCollectionByTransportUrl = (addons) => {
        const result = []
        const indexByUrl = new Map()
        for (const addon of addons) {
            const key = getAddonUrlKey(addon?.transportUrl)
            if (!key) {
                result.push(addon)
                continue
            }
            const existingIndex = indexByUrl.get(key)
            if (existingIndex === undefined) {
                indexByUrl.set(key, result.length)
                result.push(addon)
                continue
            }
            result[existingIndex] = mergeDuplicateAddon(result[existingIndex], addon)
        }
        return result
    }

    const getAuthCollectionKey = (authKey) => {
        if (!authKey || typeof authKey !== 'string') return null
        return createHash('sha256').update(authKey).digest('hex')
    }

    const returnLastGoodCollection = (authKey, reason) => {
        const lastGood = getLastGoodCollection(authKey)
        if (!lastGood?.length) return null
        fastify.log.warn({ category: 'Sync' }, `[Proxy] Returning last-good addon collection after ${reason}`)
        trace('proxy.get', 'served-last-good', { key: keyTag(authKey), reason, count: lastGood.length, addons: briefAddons(lastGood) })
        return { result: { addons: lastGood, lastModified: Date.now() }, recoveredFromLastGood: true }
    }

    const rememberGoodCollection = (authKey, addons, { allowEmpty = false } = {}) => {
        const key = getAuthCollectionKey(authKey)
        if (!key || !Array.isArray(addons) || (addons.length === 0 && !allowEmpty)) return
        if (lastGoodAddonCollections.size >= MAX_TRACKED_COLLECTIONS) {
            const oldest = lastGoodAddonCollections.keys().next().value
            if (oldest) lastGoodAddonCollections.delete(oldest)
        }
        lastGoodAddonCollections.set(key, {
            addons: addons.map(sanitizeAddonForStremio),
            ts: Date.now(),
        })
    }

    const getLastGoodCollection = (authKey) => {
        const key = getAuthCollectionKey(authKey)
        return key ? lastGoodAddonCollections.get(key)?.addons || null : null
    }

    const validateAddonCollection = (addons) => {
        if (!Array.isArray(addons)) return 'Addon collection must be an array'
        if (addons.length > MAX_ADDON_COLLECTION_SIZE) return `Addon collection exceeds ${MAX_ADDON_COLLECTION_SIZE} entries`
        for (let i = 0; i < addons.length; i++) {
            const addon = addons[i]
            if (!addon?.transportUrl) return `addons[${i}] is missing transportUrl`
            try {
                const parsed = new URL(String(addon.transportUrl).replace(/^stremio:\/\//i, 'https://'))
                if (!['http:', 'https:'].includes(parsed.protocol)) return `addons[${i}] has unsupported URL protocol`
            } catch {
                return `addons[${i}] has invalid transportUrl`
            }
            if (!addon.manifest?.id || !addon.manifest?.name || !addon.manifest?.version) {
                return `addons[${i}].manifest is missing required fields`
            }
        }
        return null
    }

    fastify.get('/api/meta-proxy', {
        config: { rateLimit: { max: 1200, timeWindow: '1 minute' } },
        schema: {
            querystring: {
                type: 'object',
                required: ['url'],
                properties: {
                    url: { type: 'string' }
                }
            }
        }
    }, async (request, reply) => {
        const authResult = await requireProxyAuth(request, reply)
        if (authResult) return authResult

        const { url } = request.query
        const accountContext = request.headers['x-account-context'] || 'Unknown'
        fastify.log.info({ category: 'MetaProxy' }, `[${maskContext(accountContext)}] Proxying request to: ${truncateUrl(url)}`)

        if (!(await isSafeUrlResolved(url))) {
            fastify.log.warn({ category: 'Security' }, `blocked unsafe proxy request: ${truncateUrl(url)}`)
            reply.status(403);
            return { error: 'Access Denied: Unsafe URL' }
        }

        // The shared manifestCache is keyed by url only, so an authenticated upstream response
        // (caller forwards a provider Bearer key for provider-config endpoints) must never be
        // cached or served cross-user. Bypass the cache entirely when Authorization is present;
        // public manifests still cache and stay shareable.
        const hasUpstreamAuth = Boolean(request.headers['authorization'])

        if (!hasUpstreamAuth) {
            const cached = manifestCache.get(url)
            if (cached && Date.now() - cached.ts < MANIFEST_CACHE_TTL) {
                if (cached.contentType) reply.type(cached.contentType)
                return cached.buffer
            }
        }

        return enqueueProxyRequest(url, async () => {
            try {
                const controller = new AbortController()
                const timeout = setTimeout(() => controller.abort(), 6000)

                const MAX_REDIRECTS = 3
                const originOf = (u) => { try { return new URL(u).origin } catch { return '' } }
                const startOrigin = originOf(url)
                let currentUrl = url
                let response
                for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
                    response = await fetch(currentUrl, {
                        signal: controller.signal,
                        redirect: 'manual',
                        headers: {
                            'User-Agent': `AIOManager/${VERSION} (Internal Proxy; Hardened)`,
                            'Accept': 'application/json, text/plain, */*',
                            ...(request.headers['authorization'] && originOf(currentUrl) === startOrigin ? { 'Authorization': request.headers['authorization'] } : {})
                        }
                    })

                    if (response.status >= 300 && response.status < 400) {
                        const location = response.headers.get('location')
                        if (!location) break
                        const resolvedUrl = new URL(location, currentUrl).href
                        if (!(await isSafeUrlResolved(resolvedUrl))) {
                            clearTimeout(timeout)
                            reply.status(403)
                            return { error: 'Access Denied: Unsafe redirect target' }
                        }
                        currentUrl = resolvedUrl
                        continue
                    }
                    break
                }

                clearTimeout(timeout)

                if (!response.ok) {
                    if (response.status === 404 || response.status === 410) manifestCache.delete(url)
                    reply.status(response.status);
                    return { error: `Upstream returned ${response.status}` }
                }

                const contentType = response.headers.get('content-type') || ''
                if (contentType.startsWith('video/') || contentType.startsWith('audio/')) {
                    reply.status(415);
                    return { error: 'Unsupported Media Type' }
                }
                if (contentType) reply.type(contentType)

                const contentLength = parseInt(response.headers.get('content-length') || '0')
                if (contentLength > 5 * 1024 * 1024) {
                    reply.status(413);
                    return { error: 'Payload Too Large (>5MB)' }
                }

                // FIX: Fastify/Compress doesn't handle Web ReadableStream well, convert to Buffer
                const arrayBuffer = await response.arrayBuffer()
                const buffer = Buffer.from(arrayBuffer)

                if (buffer.length > 5 * 1024 * 1024) {
                    reply.status(413);
                    return { error: 'Payload Too Large (>5MB)' }
                }

                if (manifestCache.size > 5000) {
                    const now = Date.now()
                    for (const [k, v] of manifestCache) {
                        if (now - v.ts > MANIFEST_CACHE_TTL) manifestCache.delete(k)
                    }
                    while (manifestCache.size > 4000) {
                        const oldestKey = manifestCache.keys().next().value
                        if (oldestKey === undefined) break
                        manifestCache.delete(oldestKey)
                    }
                }
                if (!hasUpstreamAuth) {
                    manifestCache.set(url, { buffer, contentType: contentType || null, ts: Date.now() })
                }

                return buffer
            } catch (err) {
                if (err.name === 'AbortError') {
                    fastify.log.error({ category: 'MetaProxy' }, `Timeout after 6s: ${truncateUrl(url)}`)
                    reply.status(504);
                    return { error: 'Gateway Timeout', details: 'Upstream addon took too long to respond (>6s)' }
                }
                fastify.log.error({ category: 'MetaProxy' }, `Failed to fetch ${truncateUrl(url)}: ${err.message}`)
                reply.status(500);
                return { error: 'Internal Proxy Error', details: 'Internal error' }
            }
        })
    })

    fastify.get('/api/proxy-image', {
        config: { rateLimit: { max: 1200, timeWindow: '1 minute' } },
        schema: {
            querystring: {
                type: 'object',
                required: ['url'],
                properties: {
                    url: { type: 'string' }
                }
            }
        }
    }, async (request, reply) => {
        const ALLOWED_IMAGE_DOMAINS = ['metahub.space', 'strem.io']
        const { url: rawUrl } = request.query

        const isAllowedImageHost = (host) => ALLOWED_IMAGE_DOMAINS.some(domain => host === domain || host.endsWith('.' + domain))

        let parsedHost
        try {
            parsedHost = new URL(rawUrl).hostname
        } catch {
            reply.status(403)
            return { error: 'Invalid URL' }
        }

        if (!isAllowedImageHost(parsedHost)) {
            reply.status(403)
            return { error: 'Domain not allowed' }
        }

        let candidates = [rawUrl]
        if (parsedHost === 'live.metahub.space' || parsedHost === 'images.metahub.space') {
            const primary = new URL(rawUrl); primary.hostname = 'images.metahub.space'
            const secondary = new URL(rawUrl); secondary.hostname = 'live.metahub.space'
            candidates = [primary.href, secondary.href]
        }

        const fetchImage = async (startUrl) => {
            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), IMAGE_PROXY_TIMEOUT_MS)
            try {
                let currentUrl = startUrl
                let response
                const MAX_REDIRECTS = 3

                for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
                    if (!(await isSafeUrlResolved(currentUrl))) {
                        return { error: 'Access Denied: Unsafe URL', status: 403 }
                    }
                    response = await enqueueProxyRequest(currentUrl, async () => {
                        return fetch(currentUrl, {
                            signal: controller.signal,
                            redirect: 'manual',
                            headers: {
                                'User-Agent': `AIOManager/${VERSION} (Image Proxy)`,
                                'Accept': 'image/*'
                            }
                        })
                    }, { queueKey: 'image-proxy', maxPerKey: IMAGE_PROXY_QUEUE_LIMIT, throttleMs: IMAGE_PROXY_THROTTLE_MS })

                    if (response.status >= 300 && response.status < 400) {
                        const location = response.headers.get('location')
                        if (!location) return { error: 'Missing redirect location', status: 502 }
                        currentUrl = new URL(location, currentUrl).href
                        continue
                    }
                    break
                }

                if (!response.ok || response.status >= 300) {
                    return { error: `Upstream returned ${response.status}`, status: 502 }
                }

                const contentType = response.headers.get('content-type') || ''
                if (!contentType.startsWith('image/')) {
                    return { error: 'Not an image', status: 415 }
                }

                const contentLength = parseInt(response.headers.get('content-length') || '0')
                if (contentLength > 10 * 1024 * 1024) {
                    return { error: 'Payload Too Large (>10MB)', status: 413 }
                }

                const buffer = Buffer.from(await response.arrayBuffer())
                if (buffer.length > 10 * 1024 * 1024) {
                    return { error: 'Payload Too Large (>10MB)', status: 413 }
                }

                return { buffer, contentType }
            } finally {
                clearTimeout(timeout)
            }
        }

        const cacheKey = normalizeImageKey(rawUrl)
        const sendImage = (contentType, buffer, cacheState) => {
            reply.header('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400')
            reply.header('X-Image-Cache', cacheState)
            reply.type(contentType)
            return buffer
        }

        const cached = imageCacheGet(cacheKey)
        if (cached) return sendImage(cached.contentType, cached.buffer, 'HIT')

        let resolution = imageInflight.get(cacheKey)
        if (!resolution) {
            resolution = (async () => {
                let lastFailure = { error: 'Image Proxy Error', status: 502 }
                for (const candidate of candidates) {
                    let result
                    try {
                        result = await fetchImage(candidate)
                    } catch (err) {
                        fastify.log.warn({ category: 'Proxy' }, `Image proxy attempt failed for ${truncateUrl(candidate)}: ${err.message}`)
                        lastFailure = { error: 'Image Proxy Error', status: 502 }
                        continue
                    }
                    if (result.buffer) {
                        imageCacheSet(cacheKey, result.buffer, result.contentType)
                        return result
                    }
                    lastFailure = result
                }
                return lastFailure
            })()
            imageInflight.set(cacheKey, resolution)
            resolution.finally(() => imageInflight.delete(cacheKey))
        }

        const result = await resolution
        if (result.buffer) return sendImage(result.contentType, result.buffer, 'MISS')

        reply.status(result.status)
        return { error: result.error }
    })

    fastify.post('/api/stremio-proxy', {
        bodyLimit: 1024 * 1024,
        config: { rateLimit: { max: 600, timeWindow: '1 minute' } },
        schema: {
            body: {
                type: 'object',
                required: ['type'],
                additionalProperties: true
            }
        }
    }, async (request, reply) => {
        const authResult = await requireProxyAuth(request, reply)
        if (authResult) return authResult

        const { type, ...payload } = request.body
        const accountContext = request.headers['x-account-context'] || 'Unknown'
        const masked = maskContext(accountContext)

        const actionMap = {
            'AddonCollectionGet': 'Refreshing Addons',
            'AddonCollectionSet': 'Pushing Addon Updates',
            'DatastoreGet': 'Syncing Library',
            'DatastorePut': 'Updating Library Items',
            'GetUser': 'Fetching User Profile'
        }

        const friendlyAction = actionMap[type] || `Operation: ${type}`
        const allowCollectionShrink = type === 'AddonCollectionSet' && payload.allowCollectionShrink === true
        delete payload.allowCollectionShrink

        if (type === 'AddonCollectionGet' || type === 'AddonCollectionSet' || type === 'DatastoreGet' || type === 'DatastorePut' || type === 'GetUser') {
            fastify.log.info({ category: 'Sync' }, `[${masked}] ${friendlyAction}...`)
        } else {
            // Strict Whitelist: Block unknown methods to prevent abuse
            fastify.log.warn({ category: 'Security' }, `[Proxy] Blocked unauthorized Stremio API call: ${type}`)
            reply.status(403);
            return { error: 'Method Not Allowed' }
        }

        // Stremio rejects addon collections when any embedded manifest is partial.
        // Fill required fields before forwarding so one blocked addon cannot poison the account.
        if (type === 'AddonCollectionSet' && Array.isArray(payload.addons)) {
            payload.addons = dedupeAddonCollectionByTransportUrl(payload.addons.map(sanitizeAddonForStremio))
            const validationError = validateAddonCollection(payload.addons)
            if (validationError) {
                fastify.log.warn({ category: 'Security' }, `[Proxy] Blocked invalid AddonCollectionSet: ${validationError}`)
                reply.status(400)
                return { error: `Invalid addon collection: ${validationError}` }
            }

            const lastGood = getLastGoodCollection(payload.authKey)
            const wouldBlock = !allowCollectionShrink && isSuspiciousShrink(lastGood?.length || 0, payload.addons.length)
            trace('proxy.set', 'incoming', { key: keyTag(payload.authKey), context: String(accountContext), allowCollectionShrink, lastGood: lastGood?.length || 0, pushing: payload.addons.length, blocked: wouldBlock, addons: briefAddons(payload.addons) })
            if (wouldBlock) {
                fastify.log.warn({ category: 'Security' }, `[Proxy] Blocked suspicious AddonCollectionSet shrink: ${lastGood.length} -> ${payload.addons.length}`)
                trace('proxy.set', 'blocked-shrink', { context: String(accountContext), lastGood: lastGood?.length || 0, pushing: payload.addons.length })
                reply.status(409)
                return { error: `Suspicious addon collection shrink blocked (${lastGood.length} → ${payload.addons.length})` }
            }
        }

        // Stremio library items must have valid ISO dates, and StremThru's Go-based worker 
        // crashes if deleted items (tombstones) have missing or empty timestamp strings.
        if (type === 'DatastorePut' && payload.collection === 'libraryItem' && Array.isArray(payload.changes)) {
            payload.changes = payload.changes.map(item => {
                if (item.removed) {
                    return {
                        ...item,
                        _ctime: item._ctime || '0001-01-01T00:00:00Z',
                        _mtime: item._mtime || '0001-01-01T00:00:00Z'
                    }
                }
                return item
            })
        }

        const MAX_RETRIES = 2
        let lastError = null

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 30000)

            try {
                if (attempt > 0) {
                    fastify.log.warn({ category: 'Sync' }, `[Proxy] Retrying Stremio API ${type} (Attempt ${attempt + 1}/${MAX_RETRIES + 1})...`)
                    await new Promise(r => setTimeout(r, 1000 * attempt))
                }

                const response = await fetch('https://api.strem.io/api/' + type.charAt(0).toLowerCase() + type.slice(1), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    signal: controller.signal
                })

                clearTimeout(timeoutId)

                if (!response.ok && response.status >= 500 && attempt < MAX_RETRIES) {
                    continue
                }

                let data
                try {
                    const responseText = await response.text()
                    data = responseText ? JSON.parse(responseText) : {}
                } catch (parseError) {
                    if (type === 'AddonCollectionGet' && response.status === 403) {
                        const recovered = returnLastGoodCollection(payload.authKey, `HTTP ${response.status} refresh response`)
                        if (recovered) return recovered
                    }
                    throw parseError
                }

                if (type === 'AddonCollectionGet' && response.status === 403) {
                    const recovered = returnLastGoodCollection(payload.authKey, `HTTP ${response.status} refresh response`)
                    if (recovered) return recovered
                    if (!data?.error) {
                        data.error = `Upstream returned ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`
                    }
                }

                if (type === 'DatastorePut' && payload.collection === 'libraryItem') {
                    const sample = payload.changes?.[0]
                    fastify.log.info({ category: 'Sync' }, `[Proxy] DatastorePut response: result=${JSON.stringify(data?.result)}, error=${JSON.stringify(data?.error)}, itemCount=${payload.changes?.length}, sampleId=${sample?._id}, sampleMtime=${sample?._mtime}, sampleRemoved=${sample?.removed}`)
                }

                if (type === 'AddonCollectionGet') {
                    const addons = data?.result?.addons
                    if (Array.isArray(addons)) {
                        const sanitizedAddons = dedupeAddonCollectionByTransportUrl(addons.map(sanitizeAddonForStremio))
                        const lastGood = getLastGoodCollection(payload.authKey)
                        if (isSuspiciousShrink(lastGood?.length || 0, sanitizedAddons.length)) {
                            if (attempt < MAX_RETRIES) {
                                fastify.log.warn({ category: 'Sync' }, `[Proxy] Suspicious refresh shrink (${lastGood.length} -> ${sanitizedAddons.length}); re-reading to confirm before trusting it.`)
                                trace('proxy.get', 'shrink-retry', { lastGood: lastGood?.length || 0, got: sanitizedAddons.length, attempt })
                                continue
                            }
                            if (sanitizedAddons.length === 0) {
                                fastify.log.warn({ category: 'Sync' }, `[Proxy] Persistent empty refresh after ${MAX_RETRIES} retries; keeping last-good (likely transient/auth glitch, not a real wipe): ${lastGood.length} -> 0`)
                                trace('proxy.get', 'served-last-good-empty', { lastGood: lastGood?.length || 0 })
                                return { result: { addons: lastGood, lastModified: Date.now() }, recoveredFromLastGood: true }
                            }
                            fastify.log.warn({ category: 'Sync' }, `[Proxy] Shrink confirmed after ${MAX_RETRIES} retries (${lastGood.length} -> ${sanitizedAddons.length}); accepting real collection and refreshing last-good.`)
                            trace('proxy.get', 'shrink-confirmed', { lastGood: lastGood?.length || 0, accepted: sanitizedAddons.length })
                        }
                        const validationError = validateAddonCollection(sanitizedAddons)
                        if (validationError && lastGood) {
                            fastify.log.warn({ category: 'Sync' }, `[Proxy] Returning last-good addon collection after invalid refresh result: ${validationError}`)
                            return { result: { addons: lastGood, lastModified: Date.now() }, recoveredFromLastGood: true }
                        }
                        data.result.addons = sanitizedAddons
                        trace('proxy.get', 'fresh', { key: keyTag(payload.authKey), context: String(accountContext), lastGood: lastGood?.length || 0, returned: sanitizedAddons.length, addons: briefAddons(sanitizedAddons) })
                        rememberGoodCollection(payload.authKey, data.result.addons, { allowEmpty: true })
                    } else if (data?.error) {
                        const errorText = typeof data.error === 'string' ? data.error : JSON.stringify(data.error)
                        if (ADDON_REFRESH_ERROR_PATTERN.test(errorText)) {
                            const recovered = returnLastGoodCollection(payload.authKey, `Stremio refresh error: ${errorText}`)
                            if (recovered) return recovered
                        }
                    }
                }

                if (type === 'AddonCollectionSet' && !data?.error && Array.isArray(payload.addons) && (payload.addons.length > 0 || allowCollectionShrink)) {
                    rememberGoodCollection(payload.authKey, payload.addons, { allowEmpty: allowCollectionShrink })
                }

                if (type === 'DatastoreGet') {
                    const lib = Array.isArray(data?.result) ? data.result : (data?.result?.library && Array.isArray(data.result.library) ? data.result.library : null)
                    if (lib) {
                        const sanitize = items => items.map(item => {
                            if (item.removed) {
                                return { ...item, _ctime: item._ctime || '0001-01-01T00:00:00Z', _mtime: item._mtime || '0001-01-01T00:00:00Z' }
                            }
                            return item
                        })
                        if (Array.isArray(data.result)) {
                            data.result = sanitize(data.result)
                        } else {
                            data.result.library = sanitize(data.result.library)
                        }
                    }
                }

                if (type === 'AddonCollectionSet') {
                    trace('proxy.set', 'response', { context: String(accountContext), httpStatus: response.status, pushed: payload.addons?.length || 0 })
                }

                return data
            } catch (err) {
                clearTimeout(timeoutId)
                lastError = err
                const isTimeout = err.name === 'AbortError'
                const isRetryable = isTimeout || ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(err.code)

                if (isRetryable && attempt < MAX_RETRIES) {
                    continue
                }
                break
            }
        }

        fastify.log.error({ category: 'Server' }, `Stremio Proxy Final Failure (${type}): ${lastError?.message ?? 'Unknown'}`)
        reply.status(500);
        return { error: 'Stremio API Proxy Failed', details: 'Internal error' }
    })

    fastify.post('/api/aiostreams-proxy/user', {
        bodyLimit: 1024 * 1024,
        config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
        schema: {
            body: {
                type: 'object',
                required: ['baseUrl', 'uuid', 'password'],
                properties: {
                    baseUrl: { type: 'string' },
                    uuid: { type: 'string' },
                    password: { type: 'string' }
                }
            }
        }
    }, async (request, reply) => {
        const { baseUrl, uuid, password } = request.body
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }

        const url = `${baseUrl}/api/v1/user`
        if (!(await isSafeUrlResolved(url))) {
            reply.status(403); return { error: 'Access Denied: Unsafe URL' }
        }
        try {
            const { response, json } = await fetchAIOStreamsJson(url, {
                headers: {
                    'Accept': 'application/json',
                    'Authorization': getAIOStreamsAuthHeader(uuid, password),
                },
            })

            if (response.status >= 300 && response.status < 400) {
                reply.status(403); return { error: 'Access Denied: Redirect not allowed' }
            }
            reply.status(response.status)
            return json
        } catch (e) {
            fastify.log.error({ category: 'AIOStreamsProxy' }, `GET failed: ${e.message}`)
            reply.status(502); return { success: false, error: { message: 'Failed to reach AIOStreams instance' } }
        }
    })

    fastify.put('/api/aiostreams-proxy', {
        config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
        schema: {
            body: {
                type: 'object',
                required: ['baseUrl', 'uuid', 'password', 'config'],
                properties: {
                    baseUrl: { type: 'string' },
                    uuid: { type: 'string' },
                    password: { type: 'string' },
                    config: { type: 'object', additionalProperties: true }
                }
            }
        }
    }, async (request, reply) => {
        const { baseUrl, uuid, password, config } = request.body
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }

        const url = `${baseUrl}/api/v1/user`
        if (!(await isSafeUrlResolved(url))) {
            reply.status(403); return { error: 'Access Denied: Unsafe URL' }
        }
        try {
            const { response, json } = await fetchAIOStreamsJson(url, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Authorization': getAIOStreamsAuthHeader(uuid, password),
                },
                body: JSON.stringify({ config }),
            })

            if (response.status >= 300 && response.status < 400) {
                reply.status(403); return { error: 'Access Denied: Redirect not allowed' }
            }
            reply.status(response.status)
            return json
        } catch (e) {
            fastify.log.error({ category: 'AIOStreamsProxy' }, `PUT failed: ${e.message}`)
            reply.status(502); return { success: false, error: { message: 'Failed to reach AIOStreams instance' } }
        }
    })

    fastify.post('/api/aiostreams-proxy', {
        bodyLimit: 1024 * 1024,
        config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
        schema: {
            body: {
                type: 'object',
                required: ['baseUrl', 'password', 'config'],
                properties: {
                    baseUrl: { type: 'string' },
                    password: { type: 'string' },
                    config: { type: 'object', additionalProperties: true }
                }
            }
        }
    }, async (request, reply) => {
        const { baseUrl, password, config } = request.body
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }

        const url = `${baseUrl}/api/v1/user`
        if (!(await isSafeUrlResolved(url))) {
            reply.status(403); return { error: 'Access Denied: Unsafe URL' }
        }
        try {
            const { response, json } = await fetchAIOStreamsJson(url, {
                method: 'POST',
                rateLimitRetries: 0,
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ password, config })
            })
            if (response.status >= 300 && response.status < 400) {
                reply.status(403); return { error: 'Access Denied: Redirect not allowed' }
            }
            reply.status(response.status)
            return json
        } catch (e) {
            fastify.log.error({ category: 'AIOStreamsProxy' }, `POST failed: ${e.message}`)
            reply.status(502); return { success: false, error: { message: 'Failed to reach AIOStreams instance' } }
        }
    })

    fastify.delete('/api/aiostreams-proxy', {
        config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
        schema: {
            body: {
                type: 'object',
                required: ['baseUrl', 'uuid', 'password'],
                properties: {
                    baseUrl: { type: 'string' },
                    uuid: { type: 'string' },
                    password: { type: 'string' }
                }
            }
        }
    }, async (request, reply) => {
        const { baseUrl, uuid, password } = request.body
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }

        const url = `${baseUrl}/api/v1/user`
        if (!(await isSafeUrlResolved(url))) {
            reply.status(403); return { error: 'Access Denied: Unsafe URL' }
        }
        try {
            const { response, json } = await fetchAIOStreamsJson(url, {
                method: 'DELETE',
                headers: {
                    'Accept': 'application/json',
                    'Authorization': getAIOStreamsAuthHeader(uuid, password),
                },
            })

            if (response.status >= 300 && response.status < 400) {
                reply.status(403); return { error: 'Access Denied: Redirect not allowed' }
            }
            reply.status(response.status)
            return json
        } catch (e) {
            fastify.log.error({ category: 'AIOStreamsProxy' }, `DELETE failed: ${e.message}`)
            reply.status(502); return { success: false, error: { message: 'Failed to reach AIOStreams instance' } }
        }
    })

    fastify.get('/api/aiostreams-check', {
        config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
        schema: {
            querystring: {
                type: 'object',
                required: ['baseUrl', 'uuid'],
                properties: {
                    baseUrl: { type: 'string' },
                    uuid: { type: 'string' }
                }
            }
        }
    }, async (request, reply) => {
        const { baseUrl, uuid } = request.query
        const authUser = await verifyAuth(request)
        if (!authUser) {
            reply.status(401)
            return { success: false, error: { message: 'Authentication required' } }
        }
        const url = `${baseUrl}/api/v1/user?uuid=${encodeURIComponent(uuid)}`
        if (!(await isSafeUrlResolved(url))) {
            reply.status(403); return { success: false, error: { message: 'Unsafe URL' } }
        }
        try {
            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), 10000)
            const MAX_REDIRECTS = 3
            let currentUrl = url
            let response
            for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
                response = await fetch(currentUrl, { method: 'HEAD', signal: controller.signal, redirect: 'manual' })
                if (response.status >= 300 && response.status < 400) {
                    const location = response.headers.get('location')
                    if (!location) {
                        clearTimeout(timeout)
                        reply.status(403); return { success: false, error: { message: 'Unsafe redirect' } }
                    }
                    const resolvedUrl = new URL(location, currentUrl).href
                    if (!(await isSafeUrlResolved(resolvedUrl))) {
                        clearTimeout(timeout)
                        reply.status(403); return { success: false, error: { message: 'Unsafe redirect target' } }
                    }
                    currentUrl = resolvedUrl
                    continue
                }
                break
            }
            clearTimeout(timeout)
            reply.status(200)
            return { success: true, exists: response.ok }
        } catch (e) {
            fastify.log.error({ category: 'AIOStreamsProxy' }, `Check failed: ${e.message}`)
            reply.status(502)
            return { success: false, error: { message: 'Failed to reach AIOStreams instance' } }
        }
    })

    fastify.get('/api/aiostreams-status', {
        config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
        schema: {
            querystring: {
                type: 'object',
                required: ['baseUrl'],
                properties: { baseUrl: { type: 'string' } }
            }
        }
    }, async (request, reply) => {
        const { baseUrl } = request.query
        const authUser = await verifyAuth(request)
        if (!authUser) {
            reply.status(401)
            return { error: { message: 'Authentication required' } }
        }
        const url = `${baseUrl}/api/v1/status`
        if (!(await isSafeUrlResolved(url))) {
            reply.status(403); return { success: false, error: { message: 'Unsafe URL' } }
        }
        try {
            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), 10000)
            const MAX_REDIRECTS = 3
            let currentUrl = url
            let response
            for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
                response = await fetch(currentUrl, { signal: controller.signal, redirect: 'manual' })
                if (response.status >= 300 && response.status < 400) {
                    const location = response.headers.get('location')
                    if (!location) {
                        clearTimeout(timeout)
                        reply.status(403); return { success: false, error: { message: 'Unsafe redirect' } }
                    }
                    const resolvedUrl = new URL(location, currentUrl).href
                    if (!(await isSafeUrlResolved(resolvedUrl))) {
                        clearTimeout(timeout)
                        reply.status(403); return { success: false, error: { message: 'Unsafe redirect target' } }
                    }
                    currentUrl = resolvedUrl
                    continue
                }
                break
            }
            clearTimeout(timeout)
            const data = await response.json()
            return { success: true, data: data.data || data }
        } catch (e) {
            return { success: false, error: { message: e.message } }
        }
    })



    const aiometadataConfigUrl = (baseUrl, path) => `${baseUrl.replace(/\/+$/, '')}/api/config${path}`

    fastify.post('/api/aiometadata-proxy/load', {
        bodyLimit: 1024 * 1024,
        config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
        schema: {
            body: {
                type: 'object',
                required: ['baseUrl', 'uuid', 'password'],
                properties: {
                    baseUrl: { type: 'string' },
                    uuid: { type: 'string' },
                    password: { type: 'string' },
                    addonPassword: { type: 'string' }
                }
            }
        }
    }, async (request, reply) => {
        const { baseUrl, uuid, password, addonPassword } = request.body
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }

        const url = aiometadataConfigUrl(baseUrl, `/load/${encodeURIComponent(uuid)}`)
        if (!(await isSafeUrlResolved(url))) {
            reply.status(403); return { error: 'Access Denied: Unsafe URL' }
        }
        try {
            const { response, json } = await fetchAIOStreamsJson(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ password, addonPassword }),
            })
            if (response.status >= 300 && response.status < 400) {
                reply.status(403); return { error: 'Access Denied: Redirect not allowed' }
            }
            reply.status(response.status)
            return json
        } catch (e) {
            fastify.log.error({ category: 'AIOMetadataProxy' }, `LOAD failed: ${e.message}`)
            reply.status(502); return { success: false, error: { message: 'Failed to reach AIOMetadata instance' } }
        }
    })

    fastify.post('/api/aiometadata-proxy/save', {
        bodyLimit: 1024 * 1024,
        config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
        schema: {
            body: {
                type: 'object',
                required: ['baseUrl', 'password', 'config'],
                properties: {
                    baseUrl: { type: 'string' },
                    password: { type: 'string' },
                    config: { type: 'object', additionalProperties: true },
                    addonPassword: { type: 'string' }
                }
            }
        }
    }, async (request, reply) => {
        const { baseUrl, password, config, addonPassword } = request.body
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }

        const url = aiometadataConfigUrl(baseUrl, '/save')
        if (!(await isSafeUrlResolved(url))) {
            reply.status(403); return { error: 'Access Denied: Unsafe URL' }
        }
        try {
            const { response, json } = await fetchAIOStreamsJson(url, {
                method: 'POST',
                rateLimitRetries: 0,
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ config, password, addonPassword }),
            })
            if (response.status >= 300 && response.status < 400) {
                reply.status(403); return { error: 'Access Denied: Redirect not allowed' }
            }
            reply.status(response.status)
            return json
        } catch (e) {
            fastify.log.error({ category: 'AIOMetadataProxy' }, `SAVE failed: ${e.message}`)
            reply.status(502); return { success: false, error: { message: 'Failed to reach AIOMetadata instance' } }
        }
    })

    fastify.post('/api/aiometadata-proxy/update', {
        bodyLimit: 1024 * 1024,
        config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
        schema: {
            body: {
                type: 'object',
                required: ['baseUrl', 'uuid', 'password', 'config'],
                properties: {
                    baseUrl: { type: 'string' },
                    uuid: { type: 'string' },
                    password: { type: 'string' },
                    config: { type: 'object', additionalProperties: true },
                    addonPassword: { type: 'string' }
                }
            }
        }
    }, async (request, reply) => {
        const { baseUrl, uuid, password, config, addonPassword } = request.body
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Unauthorized' } }

        const url = aiometadataConfigUrl(baseUrl, `/update/${encodeURIComponent(uuid)}`)
        if (!(await isSafeUrlResolved(url))) {
            reply.status(403); return { error: 'Access Denied: Unsafe URL' }
        }
        try {
            const { response, json } = await fetchAIOStreamsJson(url, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ config, password, addonPassword }),
            })
            if (response.status >= 300 && response.status < 400) {
                reply.status(403); return { error: 'Access Denied: Redirect not allowed' }
            }
            reply.status(response.status)
            return json
        } catch (e) {
            fastify.log.error({ category: 'AIOMetadataProxy' }, `UPDATE failed: ${e.message}`)
            reply.status(502); return { success: false, error: { message: 'Failed to reach AIOMetadata instance' } }
        }
    })

    fastify.get('/api/aiometadata-status', {
        config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
        schema: {
            querystring: {
                type: 'object',
                required: ['baseUrl'],
                properties: { baseUrl: { type: 'string' } }
            }
        }
    }, async (request, reply) => {
        const { baseUrl } = request.query
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: { message: 'Authentication required' } } }

        const url = aiometadataConfigUrl(baseUrl, '/addon-info')
        if (!(await isSafeUrlResolved(url))) {
            reply.status(403); return { success: false, error: { message: 'Unsafe URL' } }
        }
        try {
            const { response, json } = await fetchAIOStreamsJson(url, { headers: { 'Accept': 'application/json' } })
            if (response.status >= 300 && response.status < 400) {
                reply.status(403); return { success: false, error: { message: 'Unsafe redirect' } }
            }
            if (!response.ok) { reply.status(response.status); return { success: false, error: { message: 'Instance returned an error' } } }
            return { success: true, data: json }
        } catch (e) {
            fastify.log.error({ category: 'AIOMetadataProxy' }, `Status failed: ${e.message}`)
            reply.status(502); return { success: false, error: { message: 'Failed to reach AIOMetadata instance' } }
        }
    })

    fastify.get('/api/aiometadata-check', {
        config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
        schema: {
            querystring: {
                type: 'object',
                required: ['baseUrl', 'uuid'],
                properties: { baseUrl: { type: 'string' }, uuid: { type: 'string' } }
            }
        }
    }, async (request, reply) => {
        const { baseUrl, uuid } = request.query
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { success: false, error: { message: 'Authentication required' } } }

        const url = aiometadataConfigUrl(baseUrl, `/trusted/${encodeURIComponent(uuid)}`)
        if (!(await isSafeUrlResolved(url))) {
            reply.status(403); return { success: false, error: { message: 'Unsafe URL' } }
        }
        try {
            const { response, json } = await fetchAIOStreamsJson(url, { headers: { 'Accept': 'application/json' } })
            if (response.status >= 300 && response.status < 400) {
                reply.status(403); return { success: false, error: { message: 'Unsafe redirect' } }
            }
            reply.status(response.status)
            return { success: response.ok, data: json }
        } catch (e) {
            fastify.log.error({ category: 'AIOMetadataProxy' }, `Check failed: ${e.message}`)
            reply.status(502); return { success: false, error: { message: 'Failed to reach AIOMetadata instance' } }
        }
    })

    fastify.all('/api/proxy/:token/*', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
        const { token } = request.params
        const pathSuffix = request.params['*']

        // We use a dummy URL for the enqueue key since token might be large, 
        // but better to decoode it to get the domain
        let targetDomain = 'unknown'
        let originalUrl = ''
        try {
            const config = JSON.parse(Buffer.from(token, 'base64').toString('utf-8'))
            targetDomain = new URL(config.url).origin
            originalUrl = config.url
        } catch (e) {
            fastify.log.warn({ category: 'Proxy' }, `Failed to decode token: ${e.message}`)
            reply.status(400);
            return { error: 'Invalid Token' }
        }

        if (!(await isSafeUrlResolved(originalUrl))) {
            fastify.log.warn({ category: 'Security' }, `blocked unsafe proxy request (Manifest Rewriter): ${truncateUrl(originalUrl)}`)
            reply.status(403);
            return { error: 'Access Denied: Unsafe URL' }
        }

        return enqueueProxyRequest(targetDomain, async () => {
            let customName = null, customLogo = null
            try {
                const configStr = Buffer.from(token, 'base64').toString('utf-8')
                const config = JSON.parse(configStr)
                const { url: originalUrl, name, logo } = config
                customName = name || null
                customLogo = logo || null

                if (!originalUrl) {
                    reply.status(400);
                    return { error: 'Invalid proxy configuration' }
                }

                let targetUrl
                if (pathSuffix && pathSuffix !== 'manifest.json' && pathSuffix !== '') {
                    if (pathSuffix.includes('..') || !/^[a-zA-Z0-9\-_./:@]+$/.test(pathSuffix)) {
                        reply.status(400);
                        return { error: 'Invalid path' }
                    }
                }
                if (pathSuffix === 'manifest.json' || pathSuffix === '') {
                    targetUrl = originalUrl
                } else {
                    const baseUrl = originalUrl.replace(/\/manifest\.json$/, '').replace(/\/$/, '')
                    targetUrl = `${baseUrl}/${pathSuffix}`
                }

                const fetchController = new AbortController()
                const fetchTimeout = setTimeout(() => fetchController.abort(), 10000)
                let response
                try {
                    response = await fetch(targetUrl, {
                        method: request.method,
                        redirect: 'manual',
                        signal: fetchController.signal,
                        headers: {
                            'User-Agent': 'AIOManager-ManifestRewriter/1.0'
                        }
                    })
                } finally {
                    clearTimeout(fetchTimeout)
                }

                if (!response.ok) {
                    reply.status(response.status);
                    return response.statusText
                }

                if ((pathSuffix === 'manifest.json' || pathSuffix === '') && (customName || customLogo)) {
                    const manifest = await response.json()
                    if (customName) manifest.name = customName
                    if (customLogo) manifest.logo = customLogo
                    manifest.description = (manifest.description || '') + '\n[Proxied by AIOManager]'
                    return manifest
                }

                const contentType = response.headers.get('content-type')
                if (contentType) reply.type(contentType)
                // FIX: Fastify/Compress doesn't handle Web ReadableStream well, convert to Buffer
                const arrayBuffer = await response.arrayBuffer()
                const buffer = Buffer.from(arrayBuffer)
                if (buffer.length > 5 * 1024 * 1024) {
                    reply.status(413);
                    return { error: 'Payload Too Large (>5MB)' }
                }
                return buffer

            } catch (err) {
                // PROXY RESILIENCE: If upstream is dead (offline), we MUST return a valid manifest
                // so Stremio doesn't delete the addon or show garbage.
                if ((pathSuffix === 'manifest.json' || pathSuffix === '') && customName) {
                    fastify.log.warn({ category: 'Proxy' }, `Upstream offline: ${targetDomain}. Serving fallback manifest for ${customName}.`)
                    return {
                        id: 'proxy-offline-' + Date.now(),
                        name: customName,
                        version: '0.0.1',
                        description: 'This addon is currently offline or unreachable. The Manager is attempting to restore connection.',
                        logo: customLogo,
                        resources: [],
                        types: [],
                        catalogs: []
                    }
                }

                fastify.log.error({ category: 'Proxy' }, `Fatal Error: ${err.message}`)
                reply.status(502);
                return { error: 'Proxy Error', details: 'Upstream Unreachable' }
            }
        })
    })

    fastify.get('/api/addon-health', {
        config: { rateLimit: { max: 120, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        const authUser = await verifyAuth(request)
        if (!authUser) { reply.status(401); return { error: 'Authentication required' } }

        const { url } = request.query

        if (!url) {
            reply.status(400);
            return { isOnline: false, error: 'Bad Request: Missing URL' }
        }

        if (!(await isSafeUrlResolved(url))) {
            reply.status(400);
            return { isOnline: false, error: 'Bad Request: Unsafe URL' }
        }

        try {
            const isOnline = await checkAddonHealthInternal(url, 'Addon Health')
            return { isOnline, error: isOnline ? undefined : 'Unreachable' }
        } catch (err) {
            fastify.log.error({ category: 'HealthProxy' }, `Failed to check health for ${url}: ${err.message}`)
            reply.status(500);
            return { isOnline: false, error: 'Internal Server Error' }
        }
    })

    fastify.get('/api/discover-proxy', {
        config: { rateLimit: { max: 600, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        const targetUrl = request.query.url
        if (!targetUrl || !targetUrl.startsWith('https://stremio-addons.net/api/v0/')) {
            return reply.code(400).send({ error: 'Invalid URL' })
        }

        const start = Date.now()
        const cacheKey = `discover:${targetUrl}`
        const cached = manifestCache.get(cacheKey)
        const isCategory = targetUrl.includes('/categories')
        const ttl = isCategory ? 60 * 60 * 1000 : 30 * 60 * 1000
        const cacheHit = Boolean(cached && Date.now() - cached.ts < ttl)
        trace('discover-proxy', 'request', { url: targetUrl, cacheHit })

        if (cacheHit) {
            reply.header('X-Cache', 'HIT')
            reply.header('Cache-TTL-Ms', ttl - (Date.now() - cached.ts))
            trace('discover-proxy', 'response', { url: targetUrl, cacheHit: true, timing: Date.now() - start })
            return reply.send(cached.data)
        }

        try {
            const data = await enqueueProxyRequest(targetUrl, async () => {
                const controller = new AbortController()
                const timeout = setTimeout(() => controller.abort(), 15000)
                try {
                    const res = await fetch(targetUrl, {
                        signal: controller.signal,
                        headers: { 'Accept': 'application/json' }
                    })
                    if (!res.ok) {
                        reply.code(res.status)
                        return { error: `Upstream returned ${res.status}` }
                    }
                    return await res.json()
                } finally {
                    clearTimeout(timeout)
                }
            })

            if (data.error) {
                reply.header('X-Cache', 'MISS')
                trace('discover-proxy', 'response', { url: targetUrl, cacheHit: false, error: true, timing: Date.now() - start })
                reply.send(data)
            } else {
                manifestCache.set(cacheKey, { data, ts: Date.now() })
                if (manifestCache.size > 5000) {
                    const now = Date.now()
                    for (const [k, v] of manifestCache) {
                        if (now - v.ts > MANIFEST_CACHE_TTL) manifestCache.delete(k)
                    }
                    while (manifestCache.size > 4000) {
                        const oldestKey = manifestCache.keys().next().value
                        if (oldestKey === undefined) break
                        manifestCache.delete(oldestKey)
                    }
                }
                reply.header('X-Cache', 'MISS')
                trace('discover-proxy', 'response', { url: targetUrl, cacheHit: false, timing: Date.now() - start })
                reply.send(data)
            }
        } catch (err) {
            const cachedStale = manifestCache.get(cacheKey)
            if (cachedStale) {
                reply.header('X-Cache', 'STALE')
                trace('discover-proxy', 'response', { url: targetUrl, cacheHit: false, stale: true, timing: Date.now() - start })
                return reply.send(cachedStale.data)
            }
            trace('discover-proxy', 'response', { url: targetUrl, cacheHit: false, error: true, timing: Date.now() - start })
            reply.code(502).send({ error: 'Failed to fetch from stremio-addons.net' })
        }
    })
}
