import { globalHealthCache, healthCheckInFlight } from '../state.js'
import { normalizeAddonUrl } from '../utils/addon-url.js'
import { truncateUrl, maskContext } from '../utils/log-helpers.js'
import { enqueueProxyRequest } from '../proxy-queue.js'
import { isSafeUrlResolved } from '../utils/ssrf.js'
import { safeFetchWithRedirects } from '../utils/safe-fetch.js'
import { trace } from '../utils/trace.js'

export const HEALTH_CACHE_TTL_MS = Math.max(10000, parseInt(process.env.AUTOPILOT_HEALTH_CACHE_TTL_MS || '30000', 10) || 30000)

const CUSTOM_CHECK_TIMEOUT_MS = 10000
const CUSTOM_CHECK_CACHE_TTL = 30000
const customCheckCache = new Map()
const customCheckInFlight = new Map()

async function mapConcurrent(items, limit, worker) {
    const results = new Array(items.length)
    let nextIndex = 0
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (nextIndex < items.length) {
            const i = nextIndex++
            results[i] = await worker(items[i], i)
        }
    })
    await Promise.all(workers)
    return results
}

const performSingleCustomCheck = async (checkUrl) => {
    if (!(await isSafeUrlResolved(checkUrl))) {
        return false
    }
    let queueKey = checkUrl
    try { queueKey = new URL(checkUrl).origin } catch (e) { }
    return enqueueProxyRequest(checkUrl, async () => {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), CUSTOM_CHECK_TIMEOUT_MS)
        try {
            const res = await safeFetchWithRedirects(checkUrl, { signal: controller.signal, methodFallback: true })
            if (!res) return false
            return res.ok || res.status === 401 || res.status === 403
        } finally {
            clearTimeout(timeout)
        }
    }, queueKey)
}

export function createHealthChecker(fastify) {
    const checkAddonHealthInternal = async (url, context = 'Autopilot') => {
        const normalizedUrl = normalizeAddonUrl(url).toLowerCase()

        const cached = globalHealthCache.get(normalizedUrl)
        if (cached && Date.now() - cached.timestamp < HEALTH_CACHE_TTL_MS) {
            return cached.isHealthy
        }

        const inFlight = healthCheckInFlight.get(normalizedUrl)
        if (inFlight) return inFlight

        const healthPromise = _performHealthCheck(url, normalizedUrl, context)
        healthCheckInFlight.set(normalizedUrl, healthPromise)
        return healthPromise
    }

    const getHealthLatency = (url) => {
        const normalizedUrl = normalizeAddonUrl(url).toLowerCase()
        return globalHealthCache.get(normalizedUrl)?.latencyMs ?? null
    }

    const _performHealthCheck = async (url, normalizedUrl, context = 'Autopilot') => {
        try {
            const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            let domain = url
            try { domain = new URL(url).origin } catch (e) { }

            const performCheck = async (target, timeoutMs, retries = 1) => {
                let checkQueueKey = target
                try { checkQueueKey = new URL(target).origin } catch (e) { }
                return enqueueProxyRequest(target, async () => {
                    for (let attempt = 0; attempt <= retries; attempt++) {
                        try {
                            const controller1 = new AbortController()
                            const timeout1 = setTimeout(() => controller1.abort(), timeoutMs)

                            const res1 = await fetch(target, {
                                method: 'HEAD',
                                signal: controller1.signal,
                                redirect: 'manual',
                                headers: { 'User-Agent': userAgent, 'Accept': 'application/json, text/plain, */*' }
                            })
                            clearTimeout(timeout1)
                            if (res1.ok || res1.status === 405 || res1.status === 401 || res1.status === 403 || (res1.status >= 300 && res1.status < 400)) return true

                            const controller2 = new AbortController()
                            const timeout2 = setTimeout(() => controller2.abort(), timeoutMs)

                            const res2 = await fetch(target, {
                                method: 'GET',
                                signal: controller2.signal,
                                redirect: 'manual',
                                headers: { 'User-Agent': userAgent, 'Accept': 'application/json, text/plain, */*' }
                            })
                            clearTimeout(timeout2)
                            if (res2.ok || res2.status === 401 || res2.status === 403 || (res2.status >= 300 && res2.status < 400)) return true

                            if (res2.status === 429) {
                                fastify.log.warn({ category: 'Autopilot' }, `Health check rate limited (429), deferring: ${truncateUrl(normalizedUrl)}`)
                                return true
                            }

                            if (res2.status >= 500 && attempt < retries) continue
                            return false
                        } catch (err) {
                            const isTimeout = err.name === 'AbortError'
                            const isNetworkError = ['ECONNRESET', 'ETIMEDOUT', 'EADDRINUSE', 'ECONNREFUSED', 'EAI_AGAIN'].includes(err.code)
                            const isTLSError = ['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'TLS_ERROR'].some(c => err.message?.includes(c) || err.code === c)

                            if (isTLSError) return true
                            if (attempt < retries && (isTimeout || isNetworkError)) {
                                await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000))
                                continue
                            }
                            return false
                        }
                    }
                    return false
                }, checkQueueKey)
            }

            const startTime = Date.now()
            const isHealthy = await performCheck(domain, 15000) || await performCheck(url, 15000)
            const latencyMs = Date.now() - startTime

            if (!isHealthy) {
                fastify.log.warn({ category: context }, `[Health] Host ${domain} is unreachable.`)
            }

            if (globalHealthCache.size > 20000) {
                const pruneNow = Date.now()
                for (const [key, val] of globalHealthCache.entries()) {
                    if (pruneNow - val.timestamp > HEALTH_CACHE_TTL_MS) globalHealthCache.delete(key)
                }
                if (globalHealthCache.size > 15000) {
                    while (globalHealthCache.size > 10000) {
                        const oldestKey = globalHealthCache.keys().next().value
                        if (oldestKey === undefined) break
                        globalHealthCache.delete(oldestKey)
                    }
                }
            }
            globalHealthCache.set(normalizedUrl, { isHealthy, latencyMs, timestamp: Date.now() })
            return isHealthy
        } finally {
            healthCheckInFlight.delete(normalizedUrl)
        }
    }

    const checkCustomUrlsHealth = async (urls, ruleId, accountId) => {
        if (!Array.isArray(urls) || urls.length === 0) return true
        trace('autopilot.customCheck', 'start', { ruleId, urlCount: urls.length })
        const results = await mapConcurrent(urls, 5, async (checkUrl) => {
            const normalized = normalizeAddonUrl(checkUrl).toLowerCase()
            const cached = customCheckCache.get(normalized)
            if (cached && Date.now() - cached.ts < CUSTOM_CHECK_CACHE_TTL) {
                return cached.healthy
            }
            const existing = customCheckInFlight.get(normalized)
            if (existing) return existing
            const promise = (async () => {
                let healthy = false
                try {
                    healthy = await performSingleCustomCheck(checkUrl)
                } catch (err) {
                    healthy = false
                    trace('autopilot.customCheck', 'error', { ruleId, url: checkUrl, error: err?.message || String(err) })
                    fastify.log.warn({ category: 'Autopilot' }, `[${maskContext(accountId)}] Custom check error for ${truncateUrl(checkUrl)}: ${err?.message}`)
                }
                customCheckCache.set(normalized, { healthy, ts: Date.now() })
                if (customCheckCache.size > 2000) {
                    const nowTs = Date.now()
                    for (const [key, val] of customCheckCache.entries()) {
                        if (nowTs - val.ts > CUSTOM_CHECK_CACHE_TTL) customCheckCache.delete(key)
                    }
                }
                if (!healthy) {
                    trace('autopilot.customCheck', 'failed', { ruleId, url: checkUrl })
                    fastify.log.warn({ category: 'Autopilot' }, `[${maskContext(accountId)}] Custom check failed for ${truncateUrl(checkUrl)}`)
                } else {
                    trace('autopilot.customCheck', 'passed', { ruleId, url: checkUrl })
                }
                return healthy
            })()
            customCheckInFlight.set(normalized, promise)
            promise.finally(() => customCheckInFlight.delete(normalized))
            return promise
        })
        return results.every(r => r === true)
    }

    return { checkAddonHealthInternal, getHealthLatency, checkCustomUrlsHealth }
}
