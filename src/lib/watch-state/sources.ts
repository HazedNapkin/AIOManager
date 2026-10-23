import type { Account } from '../../types/account.ts'
import type { Connection } from '../../types/connection.ts'
import type { WatchStateSource } from './types.ts'
import { watchFingerprint } from './records.ts'
import { createStremioWatchSource, type StremioWatchSourceOptions } from './source-stremio.ts'
import { createNuvioWatchSource, type NuvioWatchSourceOptions } from './source-nuvio.ts'
import { createRealStreamWatchSource, type RealStreamWatchSourceOptions } from './source-realstream.ts'
import { createStremioWatchRequest } from './stremio-request.ts'

const SOURCE_PLATFORMS = ['stremio', 'nuvio', 'realstream', 'jellyfin']
const SOURCE_LABELS: Record<string, string> = { stremio: 'Stremio', nuvio: 'Nuvio', realstream: 'RealStream', jellyfin: 'Jellyfin-compatible server' }
const REALSTREAM_DEFAULT_BASE = 'https://realbase.fortheweak.cloud'
const REALSTREAM_AUTH_REFRESH_PATH = '/api/collections/users/auth-refresh'
const REQUEST_TIMEOUT_MS = 30_000
const NUVIO_READ_RPCS = ['sync_pull_profiles', 'sync_pull_watched_items', 'sync_pull_watch_progress']
const isNativeConnection = (connection: Connection) => !connection.connectionType || connection.connectionType === 'native'

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
    const connections = stored.filter(connection => SOURCE_PLATFORMS.includes(connection.platform) && connection.enabled && isNativeConnection(connection))
    if (account.authKey && !stored.some(connection => connection.platform === 'stremio' && isNativeConnection(connection))) {
        connections.unshift({ id: 'native-stremio', platform: 'stremio', connectionType: 'native', enabled: true, status: 'active', credentials: { authKey: account.authKey }, lastSync: 0, lastKnownAddonCount: 0, capabilities: [], consecutiveFailures: 0 })
    }
    return connections
}

export function migrationPlatformLabel(connection: Connection): string {
    if (connection.platform !== 'jellyfin') return Object.hasOwn(SOURCE_LABELS, connection.platform) ? SOURCE_LABELS[connection.platform] : 'Media connection'
    // Only known product names are public labels. A compatible server can return an
    // arbitrary productName, so never exempt that raw value from privacy masking.
    const productNames: Record<string, string> = { jellyfin: 'Jellyfin', aiostreams: 'AIOStreams', aiometadata: 'AIOMetadata' }
    const product = connection.mediaServer?.product || ''
    const productName = connection.mediaServer?.productName?.trim().toLowerCase() || ''
    return Object.hasOwn(productNames, product) ? productNames[product]
        : Object.hasOwn(productNames, productName) ? productNames[productName] : 'Jellyfin'
}

export function migrationSourceLabel(connection: Connection, formatPrivate: (value: string) => string = value => value): string {
    const platform = migrationPlatformLabel(connection)
    const customLabel = connection.displayName?.trim() || connection.mediaServer?.serverName?.trim()
        || (connection.platform === 'jellyfin' ? connection.mediaServer?.productName?.trim() : '')
    return customLabel && customLabel.toLowerCase() !== platform.toLowerCase()
        ? `${platform} · ${formatPrivate(customLabel)}` : platform
}

export function migrationConnectionLabel(connection: Connection, peers: readonly Connection[], formatPrivate: (value: string) => string = value => value, formatProfile = formatPrivate): string {
    const siblings = peers.filter(item => item.platform === connection.platform)
    const index = siblings.findIndex(item => item.id === connection.id)
    const identity = connection.mediaServer?.userName || connection.credentials?.email
    const profile = connection.platform === 'nuvio'
        ? connection.credentials?.profileIndex || connection.credentials?.profileId
        : connection.credentials?.stremioProfileName
    const context = connection.platform === 'nuvio'
        ? profile ? `Profile ${formatProfile(profile)}` : 'Primary profile'
        : profile ? formatProfile(profile) : ''
    return `${migrationSourceLabel(connection, formatPrivate)}${identity && identity !== connection.displayName ? ` · ${formatPrivate(identity)}` : ''}${context ? ` · ${context}` : ''}${siblings.length > 1 && index >= 0 ? ` · Connection ${index + 1}` : ''}`
}

function normalizedBaseUrl(value: string): string {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error('The connection URL is invalid. Reconnect before importing watch state.')
    }
    return url.href.replace(/\/+$/, '')
}

export async function stremioWatchSession(account: Account, connection: Connection, key: CryptoKey, signal: AbortSignal, assertCurrent: () => void = () => {}): Promise<StremioWatchSourceOptions> {
    const { decrypt } = await import('../crypto.ts')
    const { getDeviceAwareAuthHeaders } = await import('../device-session.ts')
    const stremioConnections = (account.connections || []).filter(item => item.platform === 'stremio' && isNativeConnection(item))
    const legacyCredential = connection.id === 'native-stremio' || stremioConnections.length === 1 && stremioConnections[0].id === connection.id
    const sealed = connection.credentials.authKey || (legacyCredential ? account.authKey : undefined)
    if (!sealed) throw new Error('Reconnect the Stremio account before importing watch state.')
    const authKey = await decrypt(sealed, key)
    const request = createStremioWatchRequest({ authKey, accountId: account.id, headers: getDeviceAwareAuthHeaders, assertCurrent })
    const readUser = async (readSignal: AbortSignal): Promise<{ id: string; label: string }> => {
        const user = object(await request('GetUser', {}, readSignal))
        if (typeof user._id !== 'string' || !user._id) throw new Error('Stremio did not verify the remote user.')
        return { id: user._id, label: typeof user.email === 'string' && user.email.trim() ? user.email.trim() : 'Signed-in Stremio account' }
    }
    const user = await readUser(signal)
    signal.throwIfAborted()
    const { fetchSeriesVideos } = await import('../watched-episodes.ts')
    return {
        connectionId: connection.id,
        label: migrationSourceLabel(connection),
        subject: user.label,
        scope: `stremio:${await watchFingerprint(user.id)}`,
        open: async openSignal => {
            const fresh = await readUser(openSignal)
            if (fresh.id !== user.id) throw new Error('The Stremio account changed. Preview again from the start.')
            return { request: (body, requestSignal) => request(body.type === 'DatastorePut' ? 'DatastorePut' : 'DatastoreGet', body, requestSignal) }
        },
        seriesVideos: fetchSeriesVideos,
    }
}

export interface NuvioWatchSession extends Omit<NuvioWatchSourceOptions, 'open'> {
    open(signal: AbortSignal): Promise<{ rpc: (fn: string, body: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>; profileIndex: number }>
}

export async function nuvioWatchSession(account: Account, connection: Connection, signal: AbortSignal, allowedWrites: readonly string[] = [], assertCurrent: () => void = () => {}): Promise<NuvioWatchSession> {
    const { DEFAULT_BASE_URL, DEFAULT_PUBLISHABLE_KEY } = await import('../drivers/nuvio.ts')
    const { fetchConnectionToken } = await import('../../api/connection.ts')
    const base = normalizedBaseUrl(connection.credentials.baseUrl || DEFAULT_BASE_URL)
    const publishableKey = connection.credentials.publishableKey || DEFAULT_PUBLISHABLE_KEY
    const open = async (openSignal: AbortSignal) => {
        const token = await fetchConnectionToken(account.id, connection.id, 'nuvio', connection.credentials.baseUrl)
        assertCurrent()
        openSignal.throwIfAborted()
        const savedProfile = connection.credentials.profileId ?? connection.credentials.profileIndex
        const chosen = savedProfile ?? token.profileId
        if (chosen === undefined || chosen === null || chosen === '') throw new Error('Choose a specific Nuvio profile in Connections first.')
        let profileIndex: number | null = null
        const rpc = async (fn: string, body: Record<string, unknown>, requestSignal: AbortSignal): Promise<unknown> => {
            if (!NUVIO_READ_RPCS.includes(fn) && !allowedWrites.includes(fn)) throw new Error('Unsupported watch-state operation.')
            if (fn !== 'sync_pull_profiles' && (profileIndex === null || body.p_profile_id !== profileIndex)) throw new Error('The selected Nuvio profile changed. Preview again before importing.')
            assertCurrent()
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
        const rows = profiles.map(object)
        const resolveProfile = (choice: string) => {
            const ids = rows.filter(row => String(row.id) === choice)
            const matches = ids.length ? ids : rows.filter(row => String(row.profile_index ?? row.profileIndex) === choice)
            return matches.length === 1 ? matches[0] : undefined
        }
        const profile = resolveProfile(String(chosen))
        const index = profile ? profile.profile_index ?? profile.profileIndex : undefined
        if (!profile || !Number.isSafeInteger(index) || Number(index) < 0) throw new Error('The saved Nuvio profile no longer matches. Select it again in Connections.')
        if (rows.filter(row => (row.profile_index ?? row.profileIndex) === index).length !== 1
            || token.profileId !== null && token.profileId !== undefined && resolveProfile(String(token.profileId)) !== profile) {
            throw new Error('The selected Nuvio profile changed. Select it again in Connections before importing.')
        }
        profileIndex = Number(index)
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
            rpc,
            profileIndex: Number(index),
            subjectId,
            profileId: typeof profile.id === 'string' ? profile.id : '',
            profileName: typeof profile.name === 'string' ? profile.name : null,
        }
    }
    const initial = await open(signal)
    signal.throwIfAborted()
    return {
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
    }
}

export interface RealStreamWatchSession extends Omit<RealStreamWatchSourceOptions, 'open'> {
    open(signal: AbortSignal): Promise<Awaited<ReturnType<RealStreamWatchSourceOptions['open']>> & {
        writeRecord(recordId: string | null, entries: Record<string, unknown>[], signal: AbortSignal): Promise<unknown>
    }>
}

// The subject label comes only from the verified auth-refresh record: its id must match the
// bound connection user, and the email is shown only when RealStream itself returned one.
// The opaque user id never feeds the visible label, and an email is never invented from it.
export function realStreamSessionSubject(record: Record<string, unknown>, userId: string): string {
    if (typeof record.id !== 'string' || record.id !== userId) throw new Error('The RealStream token belongs to a different remote user. Reconnect before importing watch state.')
    const email = typeof record.email === 'string' ? record.email.trim() : ''
    return email || 'Signed-in RealStream account'
}

export async function realStreamWatchSession(account: Account, connection: Connection, signal: AbortSignal, assertCurrent: () => void = () => {}): Promise<RealStreamWatchSession> {
    const { fetchConnectionToken } = await import('../../api/connection.ts')
    const userId = connection.credentials.userId
    if (!userId) throw new Error('Reconnect RealStream to verify its remote user.')
    const base = normalizedBaseUrl(connection.credentials.baseUrl || REALSTREAM_DEFAULT_BASE)
    const open = async (openSignal: AbortSignal) => {
        const token = await fetchConnectionToken(account.id, connection.id, 'realstream', connection.credentials.baseUrl)
        assertCurrent()
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
        if (typeof data.token !== 'string' || !data.token) throw new Error('RealStream did not confirm the sign-in. Reconnect and retry.')
        const subject = realStreamSessionSubject(record, userId)
        const accessToken = data.token
        const fetchPage = async (page: number, perPage: number, requestSignal: AbortSignal) => {
            assertCurrent()
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
        const writeRecord = async (recordId: string | null, entries: Record<string, unknown>[], writeSignal: AbortSignal) => {
            assertCurrent()
            if (recordId !== null && !/^[a-zA-Z0-9_-]{1,128}$/.test(recordId)) throw new Error('The destination progress record could not be identified.')
            writeSignal.throwIfAborted()
            const result = await fetch(`${base}/api/collections/progress/records${recordId ? `/${encodeURIComponent(recordId)}` : ''}`, {
                method: recordId ? 'PATCH' : 'POST',
                headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ user: userId, data: entries }),
                signal: AbortSignal.any([writeSignal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
                credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error',
            })
            if (!result.ok) throw new Error(`RealStream refused this update (HTTP ${result.status}). Preview again before retrying.`)
            return result.json()
        }
        return { fetchPage, writeRecord, subject }
    }
    const initial = await open(signal)
    signal.throwIfAborted()
    return {
        connectionId: connection.id,
        label: migrationSourceLabel(connection),
        subject: initial.subject,
        scope: `realstream:${await watchFingerprint([base, userId])}`,
        open: async openSignal => {
            const fresh = await open(openSignal)
            return { fetchPage: fresh.fetchPage, writeRecord: fresh.writeRecord }
        },
    }
}

async function createJellyfinMigrationSource(connection: Connection, key: CryptoKey, signal: AbortSignal): Promise<WatchStateSource> {
    const { createJellyfinWatchSource } = await import('./jellyfin.ts')
    const { decrypt } = await import('../crypto.ts')
    return createJellyfinWatchSource(connection, value => decrypt(value, key), signal)
}

export async function createWatchMigrationSource(account: Account, key: CryptoKey, connectionId: string, signal: AbortSignal, assertCurrent: () => void = () => {}): Promise<WatchStateSource> {
    const connection = watchMigrationSources(account).find(item => item.id === connectionId)
    if (!connection) throw new Error('This connection is not available as a watch-state source.')
    try {
        assertCurrent()
        if (connection.platform === 'stremio') return createStremioWatchSource(await stremioWatchSession(account, connection, key, signal, assertCurrent))
        if (connection.platform === 'nuvio') return createNuvioWatchSource(await nuvioWatchSession(account, connection, signal, [], assertCurrent))
        if (connection.platform === 'realstream') return createRealStreamWatchSource(await realStreamWatchSession(account, connection, signal, assertCurrent))
        if (connection.platform === 'jellyfin') return await createJellyfinMigrationSource(connection, key, signal)
        throw new Error('This connection is not available as a watch-state source.')
    } catch (error) {
        if (signal.aborted) throw error
        throw sanitizedError(error, 'Could not verify this source. Reconnect it, then preview again.')
    }
}
