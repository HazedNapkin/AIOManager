import { DOMAIN_THROTTLE_MS, MAX_QUEUE_PER_KEY, MAX_QUEUE_SIZE, PROXY_CONCURRENCY_LIMIT } from './config.js'
import { domainLastRequestTime, proxyQueue, proxyQueueKeyCounts, serverState } from './state.js'

export const processQueue = async () => {
    if (proxyQueue.length === 0 || serverState.activeProxyRequests >= PROXY_CONCURRENCY_LIMIT) return

    const request = proxyQueue.shift()
    const { task, resolve, reject, url, throttleMs = DOMAIN_THROTTLE_MS } = request

    let origin = ''
    try {
        origin = new URL(url).origin
    } catch (e) { origin = url }

    const now = Date.now()
    const lastRequest = domainLastRequestTime.get(origin) || 0
    const waitTime = Math.max(0, throttleMs - (now - lastRequest))

    if (waitTime > 0) {
        proxyQueue.push(request)
        setTimeout(processQueue, 100)
        return
    }

    if (domainLastRequestTime.size > 1000 && now - serverState.domainLastPruneTime > 30000) {
        serverState.domainLastPruneTime = now
        const pruneThreshold = now - (5 * 60 * 1000)
        for (const [domain, lastTime] of domainLastRequestTime.entries()) {
            if (lastTime < pruneThreshold) domainLastRequestTime.delete(domain)
        }
        if (domainLastRequestTime.size > 1000) {
            const keys = Array.from(domainLastRequestTime.keys()).slice(0, 200)
            keys.forEach(k => domainLastRequestTime.delete(k))
        }
    }
    domainLastRequestTime.set(origin, now)
    serverState.activeProxyRequests++

    try {
        const result = await task()
        resolve(result)
    } catch (err) {
        reject(err)
    } finally {
        if (request.queueKey) {
            const count = proxyQueueKeyCounts.get(request.queueKey) || 1
            const newCount = count - 1
            if (newCount <= 0) { proxyQueueKeyCounts.delete(request.queueKey) } else { proxyQueueKeyCounts.set(request.queueKey, newCount) }
        }
        serverState.activeProxyRequests--
        processQueue()
    }
}

export const enqueueProxyRequest = (url, task, options = null) => {
    return new Promise((resolve, reject) => {
        if (proxyQueue.length >= MAX_QUEUE_SIZE) {
            reject(new Error('Proxy queue saturated. Please try again in a moment.'))
            return
        }
        const queueOptions = typeof options === 'string'
            ? { queueKey: options }
            : (options || {})
        const { queueKey = null, throttleMs = DOMAIN_THROTTLE_MS } = queueOptions
        if (queueKey) {
            const current = proxyQueueKeyCounts.get(queueKey) || 0
            if (current >= MAX_QUEUE_PER_KEY) {
                reject(new Error('Too many pending requests. Please try again in a moment.'))
                return
            }
            proxyQueueKeyCounts.set(queueKey, current + 1)
        }
        proxyQueue.push({ url, task, resolve, reject, queueKey, throttleMs })
        processQueue()
    })
}
