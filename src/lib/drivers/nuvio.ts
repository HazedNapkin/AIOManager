const DEFAULT_BASE_URL = 'https://api.nuvio.tv'
const DEFAULT_PUBLISHABLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzgxNTIxMzQ2LCJleHAiOjE5MzkyMDEzNDZ9.tmQaj682pwzehpqlgCDMnySOqiUvpgRbrE43T4VJpDI'
const REST_PATH = '/rest/v1'
const RPC_PATH = `${REST_PATH}/rpc`
const RPC_TIMEOUT_MS = 30000
const REST_TIMEOUT_MS = 15000

interface NuvioError extends Error {
    status?: number
    isAuthError?: boolean
    data?: unknown
}

interface DriverAddon {
    transportUrl?: string
    manifest?: { name?: string }
    flags?: { enabled?: boolean }
    enabled?: boolean
}

interface DriverPlugin {
    url?: string
    name?: string
    enabled?: boolean
    repo_type?: string | null
}

// Client-side Nuvio driver. No authenticate/refresh; the server owns the rotating refresh token
// (the client fetches a fresh access token from the server before writing).
export function createNuvioDriver(options: { baseUrl?: string; publishableKey?: string } = {}) {
    const baseUrl = options.baseUrl || DEFAULT_BASE_URL
    const publishableKey = options.publishableKey || DEFAULT_PUBLISHABLE_KEY

    const makeHeaders = (accessToken: string): Record<string, string> => ({
        'Content-Type': 'application/json',
        'apikey': publishableKey,
        'Authorization': `Bearer ${accessToken}`,
    })

    const rpc = async (fn: string, body: unknown, accessToken: string, opts: { retries?: number } = {}) => {
        const retries = opts.retries ?? 2
        let lastErr: unknown
        for (let attempt = 0; attempt <= retries; attempt++) {
            let res: Response
            try {
                res = await fetch(`${baseUrl}${RPC_PATH}/${fn}`, {
                    method: 'POST',
                    headers: makeHeaders(accessToken),
                    body: JSON.stringify(body),
                    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
                })
            } catch (err) {
                lastErr = err
                if (attempt < retries) { await new Promise(r => setTimeout(r, 400 * (attempt + 1))); continue }
                throw err
            }
            if (!res.ok) {
                const err: NuvioError = new Error(`Nuvio RPC ${fn} returned ${res.status}`)
                err.status = res.status
                err.isAuthError = res.status === 401
                try { err.data = await res.json() } catch { /* body not JSON */ }
                if (res.status >= 500 && attempt < retries) { lastErr = err; await new Promise(r => setTimeout(r, 400 * (attempt + 1))); continue }
                throw err
            }
            if (res.status === 204) return null
            return res.json()
        }
        throw lastErr
    }

    async function resolveProfileIndex(accessToken: string, profileId?: string | number, opts: { strict?: boolean } = {}): Promise<number> {
        if (typeof profileId === 'number' && Number.isFinite(profileId) && profileId > 0) return profileId
        const stringId = String(profileId || '').trim()
        if (/^\d+$/.test(stringId)) return parseInt(stringId, 10)

        let profiles: Array<Record<string, unknown>> = []
        try { profiles = await rpc('sync_pull_profiles', {}, accessToken) } catch { /* default below */ }
        if (Array.isArray(profiles) && stringId) {
            const match = profiles.find(p => p.id === stringId)
            if (match) {
                const idx = (match.profile_index ?? match.profileIndex) as number
                if (Number.isFinite(idx) && idx > 0) return idx
            }
        }
        if (opts.strict && stringId) {
            const err: NuvioError = new Error('Could not resolve the Nuvio profile to write; refusing to fall back to the primary profile')
            err.status = 404
            throw err
        }
        if (!Array.isArray(profiles) || profiles.length === 0) return 1
        if (profiles.find(p => (p.profile_index ?? p.profileIndex) === 1)) return 1
        const fallbackIdx = (profiles[0].profile_index ?? profiles[0].profileIndex) as number
        if (Number.isFinite(fallbackIdx) && fallbackIdx > 0) return fallbackIdx
        return 1
    }

    return {
        async pullProfiles(accessToken: string): Promise<Array<Record<string, unknown>>> {
            const profiles = await rpc('sync_pull_profiles', {}, accessToken)
            return Array.isArray(profiles) ? profiles : []
        },

        async writeAddons(accessToken: string, addons: DriverAddon[], profileId?: string | number) {
            const idx = await resolveProfileIndex(accessToken, profileId, { strict: true })
            return rpc('sync_push_addons', {
                p_profile_id: idx,
                p_addons: addons.map((a, i) => ({
                    url: a.transportUrl || '',
                    name: a.manifest?.name || '',
                    enabled: (a.flags?.enabled ?? a.enabled) !== false,
                    sort_order: i,
                })),
            }, accessToken)
        },

        async readAddons(accessToken: string, profileId?: string | number) {
            const idx = await resolveProfileIndex(accessToken, profileId)
            const query = `select=*&profile_id=eq.${idx}&order=sort_order`
            const res = await fetch(`${baseUrl}${REST_PATH}/addons?${query}`, {
                method: 'GET',
                headers: makeHeaders(accessToken),
                signal: AbortSignal.timeout(REST_TIMEOUT_MS),
            })
            if (!res.ok) {
                const err: NuvioError = new Error(`Nuvio readAddons returned ${res.status}`)
                err.status = res.status
                err.isAuthError = res.status === 401
                throw err
            }
            const addons = await res.json()
            return Array.isArray(addons) ? addons : []
        },

        async readWatchHistory(accessToken: string, profileId?: string | number, opts: { page?: number; pageSize?: number } = {}) {
            const idx = await resolveProfileIndex(accessToken, profileId)
            const rows = await rpc('sync_pull_watched_items', {
                p_profile_id: idx,
                p_page: opts.page ?? 1,
                p_page_size: opts.pageSize ?? 100000,
            }, accessToken)
            return Array.isArray(rows) ? rows : []
        },

        async readWatchProgress(accessToken: string, profileId?: string | number) {
            const idx = await resolveProfileIndex(accessToken, profileId)
            const rows = await rpc('sync_pull_watch_progress', { p_profile_id: idx }, accessToken)
            return Array.isArray(rows) ? rows : []
        },

        async readPlugins(accessToken: string, profileId?: string | number) {
            const idx = await resolveProfileIndex(accessToken, profileId)
            const query = `select=*&profile_id=eq.${idx}&order=sort_order`
            const res = await fetch(`${baseUrl}${REST_PATH}/plugins?${query}`, {
                method: 'GET',
                headers: makeHeaders(accessToken),
                signal: AbortSignal.timeout(REST_TIMEOUT_MS),
            })
            if (!res.ok) {
                const err: NuvioError = new Error(`Nuvio readPlugins returned ${res.status}`)
                err.status = res.status
                err.isAuthError = res.status === 401
                throw err
            }
            const plugins = await res.json()
            return Array.isArray(plugins) ? plugins : []
        },

        async writePlugins(accessToken: string, plugins: DriverPlugin[], profileId?: string | number) {
            const idx = await resolveProfileIndex(accessToken, profileId, { strict: true })
            return rpc('sync_push_plugins', {
                p_profile_id: idx,
                p_plugins: plugins.map((p, i) => ({
                    url: p.url,
                    name: p.name,
                    enabled: p.enabled !== false,
                    sort_order: i,
                    repo_type: p.repo_type ?? null,
                })),
            }, accessToken)
        },

        // Read-only surfaces. AIOManager manages addons/plugins; library, collections, and settings
        // are user-owned on Nuvio and only displayed here (their pushes are full-replace, so writing
        // a partial view would delete the user's data).
        async readLibrary(accessToken: string, profileId?: string | number, opts: { limit?: number; offset?: number } = {}) {
            const idx = await resolveProfileIndex(accessToken, profileId)
            const rows = await rpc('sync_pull_library', { p_profile_id: idx, p_limit: opts.limit ?? 500, p_offset: opts.offset ?? 0 }, accessToken)
            return Array.isArray(rows) ? rows : []
        },

        async readCollections(accessToken: string, profileId?: string | number): Promise<Array<Record<string, unknown>>> {
            const idx = await resolveProfileIndex(accessToken, profileId)
            const res = await rpc('sync_pull_collections', { p_profile_id: idx }, accessToken)
            const obj = Array.isArray(res) ? res[0] : res
            const list = obj?.collections_json
            return Array.isArray(list) ? list : []
        },

        // Rename via a surgical PostgREST PATCH on the profiles row (by uuid), so it can't touch
        // other profiles the way the sync_push_profiles RPC might.
        async renameProfile(accessToken: string, profileId: string, name: string) {
            const res = await fetch(`${baseUrl}${REST_PATH}/profiles?id=eq.${encodeURIComponent(profileId)}`, {
                method: 'PATCH',
                headers: { ...makeHeaders(accessToken), Prefer: 'return=minimal' },
                body: JSON.stringify({ name }),
                signal: AbortSignal.timeout(REST_TIMEOUT_MS),
            })
            if (!res.ok) {
                const err: NuvioError = new Error(`Nuvio renameProfile returned ${res.status}`)
                err.status = res.status
                err.isAuthError = res.status === 401
                throw err
            }
            return null
        },

        async createProfile(accessToken: string, params: { profileIndex: number; name: string; avatarColorHex?: string }) {
            const existing = await rpc('sync_pull_profiles', {}, accessToken)
            const rows: Array<Record<string, unknown>> = Array.isArray(existing) ? existing : []
            const p_profiles = rows
                .filter(r => Number(r.profile_index ?? r.profileIndex) !== params.profileIndex)
                .map(r => ({
                    profile_index: Number(r.profile_index ?? r.profileIndex),
                    name: r.name,
                    avatar_color_hex: r.avatar_color_hex ?? null,
                    uses_primary_addons: r.uses_primary_addons ?? false,
                    uses_primary_plugins: r.uses_primary_plugins ?? false,
                    avatar_id: r.avatar_id ?? null,
                }))
            p_profiles.push({
                profile_index: params.profileIndex,
                name: params.name,
                avatar_color_hex: params.avatarColorHex ?? null,
                uses_primary_addons: false,
                uses_primary_plugins: false,
                avatar_id: null,
            })
            return rpc('sync_push_profiles', { p_profiles, p_client_max_profiles: 5 }, accessToken, { retries: 0 })
        },

        async deleteProfile(accessToken: string, profileId: string | number) {
            const idx = await resolveProfileIndex(accessToken, profileId, { strict: true })
            return rpc('sync_delete_profile_data', { p_profile_id: idx }, accessToken, { retries: 0 })
        },

        async deleteWatchHistory(accessToken: string, keys: Array<{ content_id: string; season?: number; episode?: number }>, profileId?: string | number) {
            const cleaned = (keys || []).filter(k => k && k.content_id)
            if (cleaned.length === 0) return null
            const idx = await resolveProfileIndex(accessToken, profileId, { strict: true })
            return rpc('sync_delete_watched_items', { p_profile_id: idx, p_keys: cleaned }, accessToken, { retries: 0 })
        },

        async deleteWatchProgress(accessToken: string, progressKeys: string[], profileId?: string | number) {
            const cleaned = (progressKeys || []).filter(Boolean)
            if (cleaned.length === 0) return null
            const idx = await resolveProfileIndex(accessToken, profileId, { strict: true })
            return rpc('sync_delete_watch_progress', { p_profile_id: idx, p_keys: cleaned }, accessToken, { retries: 0 })
        },
    }
}
