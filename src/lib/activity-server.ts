import { deriveSyncToken } from '@/lib/crypto'
import { useSyncStore } from '@/store/syncStore'
import { useWatchEventStore } from '@/store/watchEventStore'

const DEFAULT_SERVER = '/api'
const STATUS_CACHE_MS = 60_000
const SERVER_EVENT_PAGE_LIMIT = 2000
const SERVER_EVENT_MAX_PAGES = 50
const SERVER_EVENT_MAX_TIME_MS = 30_000
const SERVER_REQUEST_TIMEOUT_MS = 10_000

interface ActivityServerStatus {
    engineEnabled?: boolean
    totalEvents?: number
    totalSnapshots?: number
}

let statusCache: { key: string; ts: number; value: ActivityServerStatus | null } | null = null

function getApiBase(serverUrl: string | undefined): string {
    const base = (serverUrl || DEFAULT_SERVER).replace(/\/+$/, '')
    if (!base) return '/api'
    return base.startsWith('http') ? (base.endsWith('/api') ? base : `${base}/api`) : base
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = SERVER_REQUEST_TIMEOUT_MS): Promise<Response> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
        return await fetch(url, { ...init, signal: controller.signal })
    } finally {
        clearTimeout(timeout)
    }
}

async function getActivityServerStatus(apiPath: string, syncToken: string, syncUser: string): Promise<ActivityServerStatus | null> {
    const cacheKey = `${apiPath}:${syncUser}`
    if (statusCache && statusCache.key === cacheKey && Date.now() - statusCache.ts < STATUS_CACHE_MS) {
        return statusCache.value
    }

    try {
        const status = await fetchWithTimeout(`${apiPath}/activity/status`, {
            headers: {
                'x-sync-password': syncToken,
                'x-sync-user': syncUser,
            },
        })
        if (!status.ok) {
            statusCache = { key: cacheKey, ts: Date.now(), value: null }
            return null
        }
        const value = await status.json()
        statusCache = { key: cacheKey, ts: Date.now(), value }
        return value
    } catch {
        statusCache = { key: cacheKey, ts: Date.now(), value: null }
        return null
    }
}

export async function fetchAndMergeServerEvents(): Promise<number> {
    const { auth, serverUrl } = useSyncStore.getState()
    if (!auth.isAuthenticated || !auth.password) return 0

    const apiPath = getApiBase(serverUrl)
    const syncToken = await deriveSyncToken(auth.password)
    const status = await getActivityServerStatus(apiPath, syncToken, auth.id)
    if (!status?.engineEnabled) return 0

    let totalMerged = 0
    let offset = 0
    const startTime = Date.now()

    for (let page = 0; page < SERVER_EVENT_MAX_PAGES && Date.now() - startTime < SERVER_EVENT_MAX_TIME_MS; page++) {
        try {
            const res = await fetchWithTimeout(
                `${apiPath}/activity/events?limit=${SERVER_EVENT_PAGE_LIMIT}&offset=${offset}`,
                {
                    headers: {
                        'x-sync-password': syncToken,
                        'x-sync-user': auth.id,
                    },
                }
            )
            if (!res.ok) break

            const data = await res.json()
            const events = data.events || []

            if (events.length === 0) break

            useWatchEventStore.getState().mergeServerEvents(events)
            totalMerged += events.length

            if (!data.hasMore) break
            offset += events.length
        } catch {
            break
        }
    }

    return totalMerged
}

export async function pushCredentialsToServer(): Promise<number> {
    const { auth, serverUrl } = useSyncStore.getState()
    if (!auth.isAuthenticated || !auth.password) return 0

    const apiPath = getApiBase(serverUrl)
    const syncToken = await deriveSyncToken(auth.password)
    const status = await getActivityServerStatus(apiPath, syncToken, auth.id)
    if (!status?.engineEnabled) return 0

    const { useAuthStore } = await import('@/store/authStore')
    const encryptionKey = useAuthStore.getState().encryptionKey
    if (!encryptionKey) return 0

    const { useAccountStore, getCachedAuthKey, getStremioAuthKey } = await import('@/store/accountStore')
    const accounts = useAccountStore.getState().accounts
    const authKeys: { accountId: string; accountName: string; authKey: string }[] = []

    for (const a of accounts) {
        const stremioKey = getStremioAuthKey(a)
        if (!stremioKey) continue
        try {
            const plainKey = await getCachedAuthKey(stremioKey, encryptionKey)
            if (plainKey) authKeys.push({ accountId: a.id, accountName: a.name, authKey: plainKey })
        } catch { continue }
    }

    if (authKeys.length === 0) return 0

    try {
        const res = await fetchWithTimeout(`${apiPath}/credentials/sync`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-sync-password': syncToken,
                'x-sync-user': auth.id,
            },
            body: JSON.stringify({ accounts: authKeys, allAccountIds: accounts.map(a => a.id) }),
        })
        if (!res.ok) return 0
        const data = await res.json()
        return data.synced || 0
    } catch {
        return 0
    }
}
