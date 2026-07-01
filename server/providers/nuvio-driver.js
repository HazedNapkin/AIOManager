const DEFAULT_BASE_URL = 'https://api.nuvio.tv'
const DEFAULT_PUBLISHABLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzgxNTIxMzQ2LCJleHAiOjE5MzkyMDEzNDZ9.tmQaj682pwzehpqlgCDMnySOqiUvpgRbrE43T4VJpDI'
const TOKEN_GRANT_PATH = '/auth/v1/token'
const REST_PATH = '/rest/v1'
const RPC_PATH = `${REST_PATH}/rpc`
const AUTH_TIMEOUT_MS = 30000
const RPC_TIMEOUT_MS = 30000
const REST_TIMEOUT_MS = 15000

export function createNuvioDriver(options = {}) {
    const baseUrl = options.baseUrl || DEFAULT_BASE_URL
    const publishableKey = options.publishableKey || DEFAULT_PUBLISHABLE_KEY

    const makeHeaders = (accessToken) => ({
        'Content-Type': 'application/json',
        'apikey': publishableKey,
        ...(accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {})
    })

    const rpc = async (fn, body, accessToken, opts = {}) => {
        const retries = opts.retries ?? 2
        let lastErr
        for (let attempt = 0; attempt <= retries; attempt++) {
            let res
            try {
                res = await fetch(`${baseUrl}${RPC_PATH}/${fn}`, {
                    method: 'POST',
                    headers: makeHeaders(accessToken),
                    body: JSON.stringify(body),
                    signal: AbortSignal.timeout(RPC_TIMEOUT_MS)
                })
            } catch (err) {
                lastErr = err
                if (attempt < retries) { await new Promise(r => setTimeout(r, 400 * (attempt + 1))); continue }
                throw err
            }
            if (!res.ok) {
                const err = new Error(`Nuvio RPC ${fn} returned ${res.status}`)
                err.status = res.status
                err.isAuthError = res.status === 401
                try { err.data = await res.json() } catch { }
                if (res.status >= 500 && attempt < retries) { lastErr = err; await new Promise(r => setTimeout(r, 400 * (attempt + 1))); continue }
                throw err
            }
            if (res.status === 204) return null
            return res.json()
        }
        throw lastErr
    }

    async function resolveProfileIndex(accessToken, profileId, opts = {}) {
        if (Number.isFinite(profileId) && profileId > 0) return profileId

        const stringId = String(profileId || '').trim()
        if (/^\d+$/.test(stringId)) return parseInt(stringId, 10)

        let profiles = []
        try {
            profiles = await rpc('sync_pull_profiles', {}, accessToken)
        } catch { }

        if (Array.isArray(profiles) && stringId) {
            const match = profiles.find(p => p.id === stringId)
            if (match) {
                const idx = match.profile_index ?? match.profileIndex
                if (Number.isFinite(idx) && idx > 0) return idx
            }
        }

        if (opts.strict && stringId) {
            const err = new Error('Could not resolve the Nuvio profile to write; refusing to fall back to the primary profile')
            err.status = 404
            throw err
        }

        if (!Array.isArray(profiles) || profiles.length === 0) return 1

        const primary = profiles.find(p =>
            (p.profile_index ?? p.profileIndex) === 1
        )
        if (primary) return 1

        const first = profiles[0]
        const fallbackIdx = first.profile_index ?? first.profileIndex
        if (Number.isFinite(fallbackIdx) && fallbackIdx > 0) return fallbackIdx

        return 1
    }

    return {
        capabilities: ['addons', 'plugins', 'profiles', 'history'],

        async authenticate(email, password) {
            const res = await fetch(`${baseUrl}${TOKEN_GRANT_PATH}?grant_type=password`, {
                method: 'POST',
                headers: makeHeaders(null),
                body: JSON.stringify({ email, password }),
                signal: AbortSignal.timeout(AUTH_TIMEOUT_MS)
            })
            if (!res.ok) {
                const err = new Error(`Nuvio auth failed: ${res.status}`)
                err.status = res.status
                err.isAuthError = res.status === 401
                try { err.data = await res.json() } catch { }
                throw err
            }
            const data = await res.json()
            return {
                accessToken: data.access_token,
                refreshToken: data.refresh_token,
                expiresAt: data.expires_at ? data.expires_at * 1000 : Date.now() + (data.expires_in || 3600) * 1000
            }
        },

        async register(email, password) {
            const res = await fetch(`${baseUrl}/auth/v1/signup`, {
                method: 'POST',
                headers: makeHeaders(null),
                body: JSON.stringify({ email, password }),
                signal: AbortSignal.timeout(AUTH_TIMEOUT_MS)
            })
            if (!res.ok) {
                let data = null
                try { data = await res.json() } catch { }
                const detail = data?.msg || data?.error_description || data?.message
                const err = new Error(`Nuvio signup failed: ${res.status}${detail ? ' - ' + detail : ''}`)
                err.status = res.status
                err.isAuthError = res.status === 400 || res.status === 422
                err.data = data
                throw err
            }
            const data = await res.json()
            if (!data.access_token) {
                const err = new Error('Account created. Confirm your email, then sign in.')
                err.needsConfirmation = true
                throw err
            }
            return {
                accessToken: data.access_token,
                refreshToken: data.refresh_token,
                expiresAt: data.expires_at ? data.expires_at * 1000 : Date.now() + (data.expires_in || 3600) * 1000
            }
        },

        async refreshAccessToken(refreshToken) {
            const res = await fetch(`${baseUrl}${TOKEN_GRANT_PATH}?grant_type=refresh_token`, {
                method: 'POST',
                headers: makeHeaders(null),
                body: JSON.stringify({ refresh_token: refreshToken }),
                signal: AbortSignal.timeout(AUTH_TIMEOUT_MS)
            })
            if (!res.ok) {
                const err = new Error(`Nuvio token refresh failed: ${res.status}`)
                err.status = res.status
                err.isAuthError = res.status === 401
                throw err
            }
            const data = await res.json()
            return {
                accessToken: data.access_token,
                refreshToken: data.refresh_token,
                expiresAt: data.expires_at ? data.expires_at * 1000 : Date.now() + (data.expires_in || 3600) * 1000
            }
        },

        async readAddons(accessToken, profileId) {
            const idx = await resolveProfileIndex(accessToken, profileId)
            const query = `select=*&profile_id=eq.${idx}&order=sort_order`
            const res = await fetch(`${baseUrl}${REST_PATH}/addons?${query}`, {
                method: 'GET',
                headers: makeHeaders(accessToken),
                signal: AbortSignal.timeout(REST_TIMEOUT_MS)
            })
            if (!res.ok) {
                const err = new Error(`Nuvio readAddons returned ${res.status}`)
                err.status = res.status
                err.isAuthError = res.status === 401
                throw err
            }
            const addons = await res.json()
            return Array.isArray(addons) ? addons : []
        },

        async readWatchHistory(accessToken, profileId, { page = 1, pageSize = 100000 } = {}) {
            const idx = await resolveProfileIndex(accessToken, profileId)
            const rows = await rpc('sync_pull_watched_items', {
                p_profile_id: idx,
                p_page: page,
                p_page_size: pageSize,
            }, accessToken)
            return Array.isArray(rows) ? rows : []
        },

        async readWatchProgress(accessToken, profileId) {
            const idx = await resolveProfileIndex(accessToken, profileId)
            const rows = await rpc('sync_pull_watch_progress', { p_profile_id: idx }, accessToken)
            return Array.isArray(rows) ? rows : []
        },

        async writeAddons(accessToken, addons, profileId) {
            const idx = await resolveProfileIndex(accessToken, profileId, { strict: true })
            return rpc('sync_push_addons', {
                p_profile_id: idx,
                p_addons: addons.map((a, i) => ({
                    url: a.transportUrl || '',
                    name: a.manifest?.name || '',
                    enabled: (a.flags?.enabled ?? a.enabled) !== false,
                    sort_order: i
                }))
            }, accessToken)
        },

        async readPlugins(accessToken, profileId) {
            const idx = await resolveProfileIndex(accessToken, profileId)
            const query = `select=*&profile_id=eq.${idx}&order=sort_order`
            const res = await fetch(`${baseUrl}${REST_PATH}/plugins?${query}`, {
                method: 'GET',
                headers: makeHeaders(accessToken),
                signal: AbortSignal.timeout(REST_TIMEOUT_MS)
            })
            if (!res.ok) {
                const err = new Error(`Nuvio readPlugins returned ${res.status}`)
                err.status = res.status
                err.isAuthError = res.status === 401
                throw err
            }
            const plugins = await res.json()
            return Array.isArray(plugins) ? plugins : []
        },

        async writePlugins(accessToken, plugins, profileId) {
            const idx = await resolveProfileIndex(accessToken, profileId, { strict: true })
            return rpc('sync_push_plugins', {
                p_profile_id: idx,
                p_plugins: plugins.map((p, i) => ({
                    url: p.url,
                    name: p.name,
                    enabled: p.enabled !== false,
                    sort_order: i,
                    repo_type: p.repo_type ?? null,
                }))
            }, accessToken)
        },

        async pullProfiles(accessToken) {
            return rpc('sync_pull_profiles', {}, accessToken)
        },

        async pushProfiles(accessToken, profiles) {
            return rpc('sync_push_profiles', {
                p_profiles: profiles.map((p, i) => ({
                    profile_index: i + 1,
                    name: p.name,
                    avatar_color_hex: p.avatarColorHex || null,
                    uses_primary_addons: p.usesPrimaryAddons || false,
                    uses_primary_plugins: p.usesPrimaryPlugins || false,
                    avatar_id: p.avatarId || null
                })),
                p_client_max_profiles: 5
            }, accessToken)
        }
    }
}
