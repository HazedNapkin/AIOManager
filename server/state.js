import crypto from 'crypto'

export const authCache = new Map()
export const AUTH_CACHE_TTL = 60_000

export const hashAuthPassword = (password) => crypto.createHash('sha256').update(String(password)).digest('hex')

export function getCachedAuth(key) {
    const entry = authCache.get(key)
    if (!entry) return null
    if (Date.now() - entry.ts > AUTH_CACHE_TTL) {
        authCache.delete(key)
        return null
    }
    authCache.delete(key)
    authCache.set(key, entry)
    return entry.passwordHash
}

export function setCachedAuth(key, password) {
    authCache.set(key, { passwordHash: hashAuthPassword(password), ts: Date.now() })
    if (authCache.size > 200) {
        const oldest = authCache.keys().next().value
        authCache.delete(oldest)
    }
}

export function invalidateCachedAuth(key) {
    authCache.delete(key)
}

export const proxyQueue = []
export const domainLastRequestTime = new Map()
export const globalHealthCache = new Map()
export const healthCheckInFlight = new Map()
export const proxyQueueKeyCounts = new Map()

export const connectionHealthCache = new Map()
export const driverRegistry = new Map()

export const serverState = {
    activeProxyRequests: 0,
    domainLastPruneTime: 0,
    isWorkerRunning: false,
    lastWorkerRun: Date.now(),
    autopilotInterval: null,
    autopilotScanCursor: '',
    autopilotLastCycleStats: null
}
