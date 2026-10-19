import type { Account } from '../../types/account.ts'
import type { Connection } from '../../types/connection.ts'
import type { WatchStateSource } from './types.ts'
import { watchFingerprint } from './records.ts'
import { createStremioWatchSource } from './source-stremio.ts'
import { createNuvioWatchSource } from './source-nuvio.ts'
import { createRealStreamWatchSource } from './source-realstream.ts'

const SOURCE_PLATFORMS = ['stremio', 'nuvio', 'realstream', 'jellyfin']
const SOURCE_LABELS: Record<string, string> = { stremio: 'Stremio', nuvio: 'Nuvio', realstream: 'RealStream', jellyfin: 'Jellyfin-compatible server' }
const REALSTREAM_DEFAULT_BASE = 'https://realbase.fortheweak.cloud'
const REALSTREAM_AUTH_REFRESH_PATH = '/api/collections/users/auth-refresh'
const REQUEST_TIMEOUT_MS = 30_000
const NUVIO_READ_RPCS = ['sync_pull_profiles', 'sync_pull_watched_items', 'sync_pull_watch_progress']

function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The remote service returned an invalid response.')
    return value as Record<string, unknown>
}

function sanitizedError(error: unknown, fallback: string): Error {
    const message = error instanceof Error && error.message ? error.message : ''
    return new Error(!message || /https?:\/\//.test(message) || message.length > 200 ? fallback : message)
}

export function watchMigrationSources(account: Pick<Account, 'authKey' | 'connections'>): Connection[] {
    const stored = account.connections || []
    const connections = stored.filter(connection => SOURCE_PLATFORMS.includes(connection.platform) && connection.enabled)
    if (account.authKey && !stored.some(connection => connection.platform === 'stremio')) {
        connections.unshift({ id: 'native-stremio', platform: 'stremio', connectionType: 'native', enabled: true, status: 'active', credentials: { authKey: account.authKey }, lastSync: 0, lastKnownAddonCount: 0, capabilities: [], consecutiveFailures: 0 })
    }
    return connections
}

export function migrationSourceLabel(connection: Connection): string {
    return connection.displayName || connection.mediaServer?.productName || SOURCE_LABELS[connection.platform] || connection.platform
}

async function createStremioMigrationSource(account: Account, connection: Connection, key: CryptoKey, signal: AbortSignal): Promise<WatchStateSource> {
    const { decrypt } = await import('../crypto.ts')
    const { getDeviceAwareAuthHeaders } = await import('../device-session.ts')
    const sealed = connection.credentials.authKey || account.authKey
    if (!sealed) throw new Error('Reconnect the Stremio account before importing watch state.')
    const authKey = await decrypt(sealed, key)
    const request = async (type: 'GetUser' | 'DatastoreGet', body: Record<string, unknown>, requestSignal: AbortSignal): Promise<unknown> => {
        const headers = await getDeviceAwareAuthHeaders()
        requestSignal.throwIfAborted()
        const response = await fetch('/api/stremio-proxy', {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json', 'x-account-context': account.id },
            body: JSON.stringify({ ...body, type, authKey }),
            signal: AbortSignal.any([requestSignal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
            redirect: 'error',
        })
        if (!response.ok) throw new Error(`Stremio refused this operation (HTTP ${response.status}). Check the connection and retry.`)
        const data = object(await response.json())
        if (data.error || data.result === false || data.result === undefined) throw new Error('Stremio did not confirm this operation.')
        return data.result
    }
    const readUser = async (readSignal: AbortSignal): Promise<string> => {
        const user = object(await request('GetUser', {}, readSignal))
        if (typeof user._id !== 'string' || !user._id) throw new Error('Stremio did not verify the remote user.')
        return user._id
    }
    const userId = await readUser(signal)
    signal.throwIfAborted()
    const { fetchSeriesVideos } = await import('../watched-episodes.ts')
    return createStremioWatchSource({
        connectionId: connection.id,
        label: migrationSourceLabel(connection),
        subject: `Verified Stremio user ${userId.slice(0, 8)}`,
        scope: `stremio:${await watchFingerprint(userId)}`,
        open: async openSignal => {
            const fresh = await readUser(openSignal)
            if (fresh !== userId) throw new Error('The Stremio account changed. Preview again from the start.')
            return { request: (body, requestSignal) => request('DatastoreGet', body, requestSignal) }
        },
        seriesVideos: fetchSeriesVideos,
    })
}

async function createNuvioMigrationSource(account: Account, connection: Connection, signal: AbortSignal): Promise<WatchStateSource> {
    const { DEFAULT_BASE_URL, DEFAULT_PUBLISHABLE_KEY } = await import('../drivers/nuvio.ts')
    const { fetchConnectionToken } = await import('../../api/connection.ts')
    const base = (connection.credentials.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')
    const publishableKey = connection.credentials.publishableKey || DEFAULT_PUBLISHABLE_KEY
    const open = async (openSignal: AbortSignal) => {
        const token = await fetchConnectionToken(account.id, connection.id, 'nuvio', connection.credentials.baseUrl)
        openSignal.throwIfAborted()
        const chosen = token.profileId ?? connection.credentials.profileId ?? connection.credentials.profileIndex
        if (chosen === undefined || chosen === null || chosen === '') throw new Error('Choose a specific Nuvio profile in Connections first.')
        const rpc = async (fn: string, body: Record<string, unknown>, requestSignal: AbortSignal): Promise<unknown> => {
            if (!NUVIO_READ_RPCS.includes(fn)) throw new Error('Unsupported watch-state operation.')
            requestSignal.throwIfAborted()
            const response = await fetch(`${base}/rest/v1/rpc/${fn}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', apikey: publishableKey, Authorization: `Bearer ${token.accessToken}` },
                body: JSON.stringify(body),
                signal: AbortSignal.any([requestSignal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
                credentials: 'omit',
                referrerPolicy: 'no-referrer',
                redirect: 'error',
            })
            if (!response.ok) throw new Error(`Nuvio refused this operation (HTTP ${response.status}). Check the selected user or profile and retry.`)
            if (response.status === 204) return null
            return response.json()
        }
        const profiles = await rpc('sync_pull_profiles', {}, openSignal)
        if (!Array.isArray(profiles)) throw new Error('Nuvio did not verify the available profiles.')
        const profile = profiles.map(object).find(row => String(row.id) === String(chosen) || String(row.profile_index ?? row.profileIndex) === String(chosen))
        const index = profile ? profile.profile_index ?? profile.profileIndex : undefined
        if (!profile || !Number.isSafeInteger(index) || Number(index) < 0) throw new Error('The saved Nuvio profile no longer matches. Select it again in Connections.')
        let subjectId: string
        try {
            let payload = token.accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
            while (payload.length % 4) payload += '='
            const decoded = object(JSON.parse(atob(payload)))
            if (typeof decoded.sub !== 'string' || !decoded.sub) throw new Error()
            subjectId = decoded.sub
        } catch {
            throw new Error('Nuvio did not supply an identifiable authenticated user.')
        }
        return {
            rpc: (fn: 'sync_pull_watched_items' | 'sync_pull_watch_progress', body: Record<string, unknown>, requestSignal: AbortSignal) => rpc(fn, body, requestSignal),
            profileIndex: Number(index),
            subjectId,
            profileId: typeof profile.id === 'string' ? profile.id : '',
            profileName: typeof profile.name === 'string' ? profile.name : null,
        }
    }
    const initial = await open(signal)
    signal.throwIfAborted()
    return createNuvioWatchSource({
        connectionId: connection.id,
        label: migrationSourceLabel(connection),
        subject: initial.profileName ?? `Profile ${initial.profileIndex}`,
        scope: `nuvio:${await watchFingerprint([base, initial.subjectId, initial.profileId, initial.profileIndex])}`,
        open: async openSignal => {
            const fresh = await open(openSignal)
            if (fresh.subjectId !== initial.subjectId || fresh.profileId !== initial.profileId || fresh.profileIndex !== initial.profileIndex) {
                throw new Error('The Nuvio user or profile changed. Preview again from the start.')
            }
            return { rpc: fresh.rpc, profileIndex: fresh.profileIndex }
        },
    })
}

async function createRealStreamMigrationSource(account: Account, connection: Connection, signal: AbortSignal): Promise<WatchStateSource> {
    const { fetchConnectionToken } = await import('../../api/connection.ts')
    const userId = connection.credentials.userId
    if (!userId) throw new Error('Reconnect RealStream to verify its remote user.')
    const base = (connection.credentials.baseUrl || REALSTREAM_DEFAULT_BASE).replace(/\/+$/, '')
    const open = async (openSignal: AbortSignal) => {
        const token = await fetchConnectionToken(account.id, connection.id, 'realstream', connection.credentials.baseUrl)
        openSignal.throwIfAborted()
        const response = await fetch(`${base}${REALSTREAM_AUTH_REFRESH_PATH}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token.accessToken}` },
            signal: AbortSignal.any([openSignal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
            redirect: 'error',
        })
        if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'The RealStream session expired. Reconnect before importing watch state.' : `RealStream refused sign-in verification (HTTP ${response.status}). Reconnect and retry.`)
        const data = object(await response.json())
        const record = object(data.record)
        if (typeof data.token !== 'string' || !data.token || typeof record.id !== 'string' || record.id !== userId) {
            throw new Error('The RealStream token belongs to a different remote user. Reconnect before importing watch state.')
        }
        const accessToken = data.token
        const fetchPage = async (page: number, perPage: number, requestSignal: AbortSignal) => {
            requestSignal.throwIfAborted()
            const filter = encodeURIComponent(`user='${userId}'`)
            const pageResponse = await fetch(`${base}/api/collections/progress/records?filter=${filter}&page=${page}&perPage=${perPage}`, {
                headers: { Authorization: `Bearer ${accessToken}` },
                signal: AbortSignal.any([requestSignal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
                credentials: 'omit',
                referrerPolicy: 'no-referrer',
                redirect: 'error',
            })
            if (!pageResponse.ok) throw new Error(`RealStream refused this read (HTTP ${pageResponse.status}). Check the connection and retry.`)
            const pageData = object(await pageResponse.json())
            if (!Array.isArray(pageData.items)) throw new Error('RealStream returned an unexpected response shape; nothing was interpreted as data.')
            return { items: pageData.items as Record<string, unknown>[], totalItems: typeof pageData.totalItems === 'number' ? pageData.totalItems : Number.NaN }
        }
        return { fetchPage }
    }
    await open(signal)
    signal.throwIfAborted()
    return createRealStreamWatchSource({
        connectionId: connection.id,
        label: migrationSourceLabel(connection),
        subject: `Verified RealStream user ${userId.slice(0, 8)}`,
        scope: `realstream:${await watchFingerprint([connection.credentials.baseUrl || 'default', userId])}`,
        open,
    })
}

async function createJellyfinMigrationSource(connection: Connection, key: CryptoKey, signal: AbortSignal): Promise<WatchStateSource> {
    const { createJellyfinWatchSource } = await import('./jellyfin.ts')
    const { decrypt } = await import('../crypto.ts')
    return createJellyfinWatchSource(connection, value => decrypt(value, key), signal)
}

export async function createWatchMigrationSource(account: Account, key: CryptoKey, connectionId: string, signal: AbortSignal): Promise<WatchStateSource> {
    const connection = watchMigrationSources(account).find(item => item.id === connectionId)
    if (!connection) throw new Error('This connection is not available as a watch-state source.')
    try {
        if (connection.platform === 'stremio') return await createStremioMigrationSource(account, connection, key, signal)
        if (connection.platform === 'nuvio') return await createNuvioMigrationSource(account, connection, signal)
        if (connection.platform === 'realstream') return await createRealStreamMigrationSource(account, connection, signal)
        if (connection.platform === 'jellyfin') return await createJellyfinMigrationSource(connection, key, signal)
        throw new Error('This connection is not available as a watch-state source.')
    } catch (error) {
        if (signal.aborted) throw error
        throw sanitizedError(error, 'Could not verify this source. Reconnect it, then preview again.')
    }
}
