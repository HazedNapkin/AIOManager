const DEFAULT_BASE_URL = 'https://realbase.fortheweak.cloud'
const REFRESH_PATH = '/api/collections/users/auth-refresh'
const ADDONS_PATH = '/api/collections/addons/records'
const PROGRESS_PATH = '/api/collections/progress/records'
const AUTH_TIMEOUT_MS = 30000
const DEFAULT_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000

import { trace } from '@/lib/trace'

const USER_FIELD = 'user'
const ADDON_TYPE = 'stremio'

export interface RealStreamTokens {
    accessToken: string
    userId: string | null
    expiresAt: number
}

export interface RealStreamProgressItem {
    content_id: string
    content_type?: string
    video_id?: string
    season?: number | null
    episode?: number | null
    position?: number
    duration?: number
    last_watched?: number
}

interface RealStreamError extends Error {
    status?: number
    isAuthError?: boolean
    data?: unknown
}

function decodeJwtExpMs(token: string): number | null {
    try {
        let payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
        while (payload.length % 4) payload += '='
        const json = JSON.parse(atob(payload))
        return typeof json.exp === 'number' ? json.exp * 1000 : null
    } catch {
        return null
    }
}

function deriveAddonName(url?: string): string {
    if (!url) return 'Untitled Addon'
    try {
        const host = new URL(url).hostname.replace(/^www\./, '')
        const first = host.split('.')[0]
        return first.charAt(0).toUpperCase() + first.slice(1) + ' Addon'
    } catch {
        return 'Untitled Addon'
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RsRecord = Record<string, any>

function mapProgressRecord(r: RsRecord): RealStreamProgressItem {
    const contentId = String(r.itemId ?? r.content_id ?? r.item_id ?? '')
    return {
        content_id: contentId,
        content_type: r.type ?? r.content_type ?? r.itemType ?? undefined,
        video_id: r.videoId ?? r.video_id ?? undefined,
        season: r.season != null ? Number(r.season) : null,
        episode: r.episode != null ? Number(r.episode) : null,
        position: Number(r.progress ?? r.position ?? r.current_time ?? 0) || 0,
        duration: Number(r.duration ?? r.total_duration ?? 0) || 0,
        last_watched: Number(r.timestamp ?? r.last_watched ?? r.updated ?? r.created ?? Date.now()) || Date.now(),
    }
}

function toRecordAddon(addon: RsRecord) {
    const transportUrl = addon.transportUrl || addon.url || ''
    const baseUrl = transportUrl.replace(/\/manifest\.json$/i, '').replace(/\/+$/, '')
    const m = addon.manifest || {}
    const resources = Array.isArray(m.resources)
        ? m.resources.map((r: string | { name?: string }) => (typeof r === 'string' ? r : r?.name)).filter(Boolean)
        : []
    return {
        background: m.background ?? null,
        baseUrl,
        description: m.description ?? null,
        enabled: (addon.flags?.enabled ?? addon.enabled) !== false,
        id: m.id || addon.id || null,
        manifestId: m.id || addon.id || null,
        idPrefixes: m.idPrefixes ?? null,
        logo: m.logo ?? null,
        manifestUrl: transportUrl,
        name: m.name || addon.name || deriveAddonName(transportUrl),
        poster: m.poster ?? null,
        resources,
        type: ADDON_TYPE,
        types: Array.isArray(m.types) ? m.types : [],
        version: m.version ?? null,
    }
}

// RealStream (PocketBase) tokens don't rotate; auth-refresh extends the current token, so the
// client may refresh directly without the family-revocation risk Nuvio has.
export function createRealStreamDriver(options: { baseUrl?: string } = {}) {
    const baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')

    const makeHeaders = (accessToken?: string | null): Record<string, string> => ({
        'Content-Type': 'application/json',
        ...(accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {}),
    })

    const request = async (method: string, path: string, accessToken?: string, body?: unknown) => {
        const res = await fetch(`${baseUrl}${path}`, {
            method,
            headers: makeHeaders(accessToken),
            ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        })
        if (!res.ok) {
            let data: RsRecord | null = null
            try { data = await res.json() } catch { /* body not JSON */ }
            const fieldErrors = data?.data && typeof data.data === 'object'
                ? Object.entries(data.data as Record<string, { message?: string; code?: string }>).map(([f, v]) => `${f} (${v?.message || v?.code || 'invalid'})`).join(', ')
                : ''
            const detail = fieldErrors
                ? `${data?.message || 'validation failed'}, fields: ${fieldErrors}`
                : (data?.message || data?.error || (data ? JSON.stringify(data) : ''))
            const err: RealStreamError = new Error(`RealStream ${method} ${path} returned ${res.status}${detail ? ': ' + detail : ''}`)
            err.status = res.status
            err.isAuthError = res.status === 401 || res.status === 403
            err.data = data
            throw err
        }
        if (res.status === 204) return null
        const text = await res.text()
        if (!text) return null
        try { return JSON.parse(text) } catch { return null }
    }

    const listRecords = async (accessToken: string, userId: string) => {
        const filter = encodeURIComponent(`${USER_FIELD}='${userId}'`)
        const data = await request('GET', `${ADDONS_PATH}?filter=${filter}&perPage=1`, accessToken)
        return Array.isArray(data?.items) ? data.items : []
    }

    return {
        async refreshAccessToken(accessToken: string): Promise<RealStreamTokens> {
            const start = Date.now()
            trace('realstreamDriver', 'refreshAccessToken.start', {})
            try {
                const res = await fetch(`${baseUrl}${REFRESH_PATH}`, {
                    method: 'POST',
                    headers: makeHeaders(accessToken),
                    signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
                })
                if (!res.ok) {
                    const err: RealStreamError = new Error(`RealStream token refresh failed: ${res.status}`)
                    err.status = res.status
                    err.isAuthError = res.status === 401 || res.status === 403
                    throw err
                }
                const data = await res.json()
                const result: RealStreamTokens = {
                    accessToken: data.token,
                    userId: data.record?.id || null,
                    expiresAt: decodeJwtExpMs(data.token) || Date.now() + DEFAULT_TOKEN_TTL_MS,
                }
                trace('realstreamDriver', 'refreshAccessToken.success', { userId: result.userId, timing: Date.now() - start })
                return result
            } catch (err) {
                trace('realstreamDriver', 'refreshAccessToken.error', { error: (err as RealStreamError)?.message, timing: Date.now() - start })
                throw err
            }
        },

        async readAddons(accessToken: string, userId: string) {
            const start = Date.now()
            trace('realstreamDriver', 'readAddons.start', { userId })
            try {
                if (!userId) throw new Error('RealStream readAddons requires a userId')
                const records = await listRecords(accessToken, userId)
                const data = records[0]?.data
                const result = Array.isArray(data) ? data : []
                trace('realstreamDriver', 'readAddons.success', { userId, count: result.length, timing: Date.now() - start })
                return result
            } catch (err) {
                trace('realstreamDriver', 'readAddons.error', { userId, error: (err as RealStreamError)?.message, timing: Date.now() - start })
                throw err
            }
        },

        async readWatchProgress(accessToken: string, userId: string): Promise<RealStreamProgressItem[]> {
            if (!userId) throw new Error('RealStream readWatchProgress requires a userId')
            const filter = encodeURIComponent(`${USER_FIELD}='${userId}'`)
            const data = await request('GET', `${PROGRESS_PATH}?filter=${filter}&perPage=200`, accessToken)
            const items = Array.isArray(data?.items) ? data.items : []
            return items.map((r: RsRecord) => mapProgressRecord(r))
        },

        async writeAddons(accessToken: string, addons: Array<RsRecord>, userId: string) {
            const start = Date.now()
            trace('realstreamDriver', 'writeAddons.start', { userId, count: addons.length })
            try {
                if (!userId) throw new Error('RealStream writeAddons requires a userId')
                const data = (addons || []).filter(a => (a.transportUrl || a.url)).map(toRecordAddon)
                if (data.length === 0) {
                    trace('realstreamDriver', 'writeAddons.success', { userId, count: 0, skipped: true, timing: Date.now() - start })
                    return { skipped: true, reason: 'No valid addons to push' }
                }
                const records = await listRecords(accessToken, userId)
                const existing = records[0]
                const result = existing ? await request('PATCH', `${ADDONS_PATH}/${existing.id}`, accessToken, { data })
                    : await request('POST', ADDONS_PATH, accessToken, { [USER_FIELD]: userId, data })
                trace('realstreamDriver', 'writeAddons.success', { userId, count: data.length, mode: existing ? 'patch' : 'post', timing: Date.now() - start })
                return result
            } catch (err) {
                trace('realstreamDriver', 'writeAddons.error', { userId, count: addons.length, error: (err as RealStreamError)?.message, timing: Date.now() - start })
                throw err
            }
        },
    }
}
