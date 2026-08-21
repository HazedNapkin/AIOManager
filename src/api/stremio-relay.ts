const STREMIO_WWW = 'https://www.strem.io'
const API_BASE = 'https://api.strem.io'

export const FACEBOOK_RELAY_POLL = { intervalMs: 1000, maxTries: 25 }
export const APPLE_RELAY_POLL = { intervalMs: 2000, maxTries: 25 }

export interface FacebookRelayAccount {
    email: string
    fbLoginToken: string
}

export interface AppleRelayAccount {
    token: string
    sub: string
    email: string
    name: string
}

export interface RelayLoginResult {
    authKey: string
    user: { _id?: string; email?: string }
}

// 128 bits of entropy as 32 hex chars, matching stremio-web's hat(128) relay state.
export function generateRelayState(): string {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function facebookRelayUrl(state: string): string {
    return `${STREMIO_WWW}/login-fb/${state}`
}

export function appleRelayUrl(state: string): string {
    return `${STREMIO_WWW}/login-apple/${state}`
}

export function buildResetPasswordUrl(email: string): string {
    const trimmed = email.trim()
    return trimmed ? `${STREMIO_WWW}/reset-password/${encodeURIComponent(trimmed)}` : `${STREMIO_WWW}/reset-password/`
}

async function fetchRelayJson(url: string, fetchImpl: typeof fetch): Promise<Record<string, unknown>> {
    const response = await fetchImpl(url)
    const data: unknown = await response.json()
    if (!data || typeof data !== 'object') throw new Error('Invalid relay response')
    return data as Record<string, unknown>
}

export async function fetchFacebookRelayAccount(state: string, fetchImpl: typeof fetch = fetch): Promise<FacebookRelayAccount> {
    const data = await fetchRelayJson(`${STREMIO_WWW}/login-fb-get-acc/${state}`, fetchImpl)
    const user = data.user as Record<string, unknown> | undefined
    if (typeof user?.email !== 'string' || typeof user.fbLoginToken !== 'string') {
        throw new Error('Facebook relay account not ready')
    }
    return { email: user.email, fbLoginToken: user.fbLoginToken }
}

export async function fetchAppleRelayAccount(state: string, fetchImpl: typeof fetch = fetch): Promise<AppleRelayAccount> {
    const data = await fetchRelayJson(`${STREMIO_WWW}/login-apple-get-acc/${state}`, fetchImpl)
    const user = data.user as Record<string, unknown> | undefined
    if (typeof user?.token !== 'string' || typeof user?.sub !== 'string' || typeof user.email !== 'string') {
        throw new Error('Apple relay account not ready')
    }
    return { token: user.token, sub: user.sub, email: user.email, name: typeof user.name === 'string' ? user.name : '' }
}

export interface RelayPollOptions {
    intervalMs?: number
    maxTries?: number
    fetchImpl?: typeof fetch
    delay?: (ms: number) => Promise<void>
    signal?: AbortSignal
}

const defaultDelay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function pollRelay<T>(
    state: string,
    defaults: { intervalMs: number; maxTries: number; failure: string },
    fetchAccount: (state: string, fetchImpl: typeof fetch) => Promise<T>,
    options: RelayPollOptions = {}
): Promise<T> {
    const intervalMs = options.intervalMs ?? defaults.intervalMs
    const maxTries = options.maxTries ?? defaults.maxTries
    const delay = options.delay ?? defaultDelay
    let tries = 0
    for (;;) {
        if (options.signal?.aborted) throw new DOMException('Relay polling cancelled', 'AbortError')
        await delay(intervalMs)
        if (options.signal?.aborted) throw new DOMException('Relay polling cancelled', 'AbortError')
        if (tries >= maxTries) throw new Error(defaults.failure)
        tries++
        try {
            return await fetchAccount(state, options.fetchImpl ?? fetch)
        } catch {
            // account not claimed on the relay yet - keep polling
        }
    }
}

export function pollFacebookRelay(state: string, options: RelayPollOptions = {}): Promise<FacebookRelayAccount> {
    return pollRelay(state, { ...FACEBOOK_RELAY_POLL, failure: 'Failed to authenticate with facebook' }, fetchFacebookRelayAccount, options)
}

export function pollAppleRelay(state: string, options: RelayPollOptions = {}): Promise<AppleRelayAccount> {
    return pollRelay(state, { ...APPLE_RELAY_POLL, failure: 'Failed to authenticate with Apple' }, fetchAppleRelayAccount, options)
}

async function postStremioApi(method: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await fetch(`${API_BASE}/api/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    })
    let data: Record<string, unknown>
    try { data = (await response.json()) as Record<string, unknown> } catch { throw new Error('Invalid response from Stremio API') }
    if (data?.error) {
        const errData = data.error as Record<string, unknown>
        throw new Error((typeof errData.message === 'string' ? errData.message : undefined) || (typeof data.error === 'string' ? String(data.error) : `Request to ${method} failed`))
    }
    return data
}

export async function exchangeFacebookLogin(fbLoginToken: string): Promise<RelayLoginResult> {
    const data = await postStremioApi('authWithFacebook', { token: fbLoginToken })
    const result = data?.result as Record<string, unknown> | undefined
    if (typeof result?.authKey !== 'string' || !result.authKey) {
        throw new Error('Invalid login response - no auth key')
    }
    const user = (result.user as Record<string, unknown> | undefined) || {}
    return {
        authKey: result.authKey,
        user: {
            _id: typeof user._id === 'string' ? user._id : undefined,
            email: typeof user.email === 'string' ? user.email : undefined,
        },
    }
}

export async function exchangeAppleLogin(credentials: { token: string; sub: string; email: string; name: string }): Promise<RelayLoginResult> {
    const data = await postStremioApi('authWithApple', { ...credentials })
    const result = data?.result as Record<string, unknown> | undefined
    if (typeof result?.authKey !== 'string' || !result.authKey) {
        throw new Error('Invalid login response - no auth key')
    }
    const user = (result.user as Record<string, unknown> | undefined) || {}
    return {
        authKey: result.authKey,
        user: {
            _id: typeof user._id === 'string' ? user._id : undefined,
            email: typeof user.email === 'string' ? user.email : undefined,
        },
    }
}

export async function deleteStremioUser(authKey: string, password: string): Promise<void> {
    const data = await postStremioApi('deleteUser', { authKey, password })
    const result = data?.result as Record<string, unknown> | undefined
    if (!result || result.success !== true) {
        throw new Error('Invalid response - the account may not have been deleted')
    }
}
