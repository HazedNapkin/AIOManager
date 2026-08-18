import { deriveSyncToken } from '@/lib/crypto'
import { useSyncStore, learnServerCredentialedAccounts } from '@/store/syncStore'
import { useWatchEventStore, type ServerActivityEvent } from '@/store/watchEventStore'

const DEFAULT_SERVER = '/api'
const STATUS_CACHE_MS = 60_000
const SERVER_EVENT_PAGE_LIMIT = 5000
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

const ACTIVITY_CURSOR_KEY = 'aio-activity-cursor-v1'
const ACTIVITY_CURSOR_MAX_AGE_MS = 24 * 60 * 60 * 1000
const MERGE_FLUSH_LIMIT = 25_000

function readActivityCursor(): number {
    try {
        const raw = localStorage.getItem(ACTIVITY_CURSOR_KEY)
        if (!raw) return 0
        const c = JSON.parse(raw) as { ts: number; at: number }
        if (!c.ts || Date.now() - c.at > ACTIVITY_CURSOR_MAX_AGE_MS) return 0
        return c.ts
    } catch { return 0 }
}

function writeActivityCursor(ts: number) {
    try { localStorage.setItem(ACTIVITY_CURSOR_KEY, JSON.stringify({ ts, at: Date.now() })) } catch {}
}

export async function fetchAndMergeServerEvents(): Promise<number> {
    const { auth, serverUrl } = useSyncStore.getState()
    if (!auth.isAuthenticated || !auth.password) return 0

    const apiPath = getApiBase(serverUrl)
    const syncToken = await deriveSyncToken(auth.password)
    const status = await getActivityServerStatus(apiPath, syncToken, auth.id)
    if (!status?.engineEnabled) return 0

    const since = readActivityCursor()
    let totalMerged = 0
    let maxTs = since
    let offset = 0
    let pullComplete = false
    const startTime = Date.now()
    const batch: ServerActivityEvent[] = []

    for (let page = 0; page < SERVER_EVENT_MAX_PAGES && Date.now() - startTime < SERVER_EVENT_MAX_TIME_MS; page++) {
        try {
            const sinceParam = since > 0 ? `&since=${since}` : ''
            const res = await fetchWithTimeout(
                `${apiPath}/activity/events?limit=${SERVER_EVENT_PAGE_LIMIT}&offset=${offset}${sinceParam}`,
                {
                    headers: {
                        'x-sync-password': syncToken,
                        'x-sync-user': auth.id,
                    },
                }
            )
            if (!res.ok) break

            const data = await res.json()
            const events = (data.events || []) as ServerActivityEvent[]

            if (events.length === 0) { pullComplete = true; break }

            batch.push(...events)
            totalMerged += events.length
            for (const e of events) if (e.timestamp > maxTs) maxTs = e.timestamp

            if (batch.length >= MERGE_FLUSH_LIMIT) {
                useWatchEventStore.getState().mergeServerEvents(batch)
                batch.length = 0
            }

            if (!data.hasMore) { pullComplete = true; break }
            offset += events.length
        } catch {
            break
        }
    }

    if (batch.length > 0) useWatchEventStore.getState().mergeServerEvents(batch)
    if (pullComplete && maxTs > 0) writeActivityCursor(maxTs)

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

    const authKeyResults = await Promise.all(accounts.map(async a => {
        const stremioKey = getStremioAuthKey(a)
        if (!stremioKey) return null
        try {
            const plainKey = await getCachedAuthKey(stremioKey, encryptionKey)
            if (plainKey) return { accountId: a.id, accountName: a.name, authKey: plainKey }
        } catch { return null }
        return null
    }))
    const authKeys = authKeyResults.filter((r): r is { accountId: string; accountName: string; authKey: string } => r !== null)

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
        learnServerCredentialedAccounts(data.serverStremioCredentialedAccounts)
        return data.synced || 0
    } catch {
        return 0
    }
}
