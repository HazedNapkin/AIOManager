import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { QueryClient, useQueries, type UseQueryResult } from '@tanstack/react-query'
import { useAuthStore } from '@/store/authStore'
import { decrypt } from '@/lib/crypto'
import { createJellyfinClient } from '@/lib/jellyfin/client'
import { openJellyfinSecret } from '@/lib/jellyfin/connection-data'
import { captureMediaRead, type JellyfinMediaReads } from '@/lib/jellyfin/reads'
import { resolveJellyfinSeries } from '@/lib/jellyfin/metadata'
import type { JellyfinItem, JellyfinSession } from '@/lib/jellyfin/types'
import type { Connection } from '@/types/connection'

// Transient, shared across cards, Activity and connection details. This cache
// is deliberately outside the persisted application query client.
const mediaQueries = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0, refetchOnMount: false } } })
const vaultEpochs = new WeakMap<CryptoKey, number>()
let nextEpoch = 0
function epoch(key: CryptoKey) {
    if (!vaultEpochs.has(key)) vaultEpochs.set(key, ++nextEpoch)
    return vaultEpochs.get(key)!
}
const subscribeVisibility = (callback: () => void) => {
    document.addEventListener('visibilitychange', callback)
    return () => document.removeEventListener('visibilitychange', callback)
}
const visible = () => !document.hidden
const waiting = { status: 'waiting' as const, message: 'Reading this server for the verified user…' }
function combine<T>(queries: UseQueryResult<T>[]) {
    return queries.map(query => ({ data: query.data, isFetching: query.isFetching, isPending: query.isPending, isError: query.isError }))
}
type LibraryReads = Pick<JellyfinMediaReads, 'resume' | 'played'>
function libraryItems(reads: LibraryReads | undefined): JellyfinItem[] {
    return reads ? [reads.resume, reads.played].flatMap(read => read.status === 'success' ? read.data.items : []) : []
}
export interface JellyfinMediaScope { accountId: string; connection: Connection }

export function useJellyfinMediaConnections(scopes: JellyfinMediaScope[]) {
    const encryptionKey = useAuthStore(state => state.encryptionKey)
    const isVisible = useSyncExternalStore(subscribeVisibility, visible, () => false)
    useEffect(() => { mediaQueries.mount(); return () => mediaQueries.unmount() }, [])
    const jobs = useMemo(() => !encryptionKey || !isVisible ? [] : scopes
        .filter(({ connection }) => connection.platform === 'jellyfin' && connection.enabled && connection.credentials?.jellyfin && connection.mediaServer?.userId)
        .map(scope => ({ ...scope, encryptionKey, queryKey: ['jellyfin-media', scope.accountId, scope.connection.id, epoch(encryptionKey), scope.connection.credentials.jellyfin, scope.connection.mediaServer!.userId, scope.connection.mediaServer?.serverId || ''] })), [scopes, encryptionKey, isVisible])
    const library = useQueries({ queries: jobs.map(job => ({
        queryKey: [...job.queryKey, 'library'], refetchInterval: 60_000,
        queryFn: async ({ signal }: { signal: AbortSignal }) => {
            const secret = await openJellyfinSecret(job.connection, value => decrypt(value, job.encryptionKey))
            signal.throwIfAborted()
            const client = createJellyfinClient(secret.baseUrl, { deviceId: secret.deviceId })
            const [resume, played] = await Promise.all([
                captureMediaRead(() => client.readResume(secret.accessToken, secret.userId, signal), signal),
                captureMediaRead(() => client.readPlayed(secret.accessToken, secret.userId, signal), signal),
            ])
            const previous = mediaQueries.getQueryData<LibraryReads>([...job.queryKey, 'library'])
            const items = await resolveJellyfinSeries(libraryItems({ resume, played }), (id, metadataSignal) => client.readItem(secret.accessToken, secret.userId, id, metadataSignal), signal, libraryItems(previous))
            let offset = 0
            for (const read of [resume, played]) {
                if (read.status !== 'success') continue
                const length = read.data.items.length
                read.data = { ...read.data, items: items.slice(offset, offset + length) }
                offset += length
            }
            return { resume, played }
        },
    })), combine }, mediaQueries)
    const sessions = useQueries({ queries: jobs.map(job => ({
        queryKey: [...job.queryKey, 'sessions'], refetchInterval: 15_000,
        queryFn: async ({ signal }: { signal: AbortSignal }) => {
            const secret = await openJellyfinSecret(job.connection, value => decrypt(value, job.encryptionKey))
            signal.throwIfAborted()
            const client = createJellyfinClient(secret.baseUrl, { deviceId: secret.deviceId })
            const read = await captureMediaRead(() => client.readSessions(secret.accessToken, secret.userId, signal), signal)
            if (read.status === 'success') {
                const library = mediaQueries.getQueryData<LibraryReads>([...job.queryKey, 'library'])
                const previous = mediaQueries.getQueryData<JellyfinMediaReads['sessions']>([...job.queryKey, 'sessions'])
                const priorItems = previous?.status === 'success' ? previous.data.flatMap(session => session.NowPlayingItem ? [session.NowPlayingItem] : []) : []
                const items = await resolveJellyfinSeries(read.data.flatMap(session => session.NowPlayingItem ? [session.NowPlayingItem] : []), (id, metadataSignal) => client.readItem(secret.accessToken, secret.userId, id, metadataSignal), signal, [...libraryItems(library), ...priorItems], 8)
                const byId = new Map(items.map(item => [item.Id, item]))
                read.data = read.data.map((session): JellyfinSession => ({ ...session, NowPlayingItem: byId.get(session.NowPlayingItem?.Id) || session.NowPlayingItem }))
            }
            return read
        },
    })), combine }, mediaQueries)
    const results = useMemo(() => jobs.map((job, i) => ({
        accountId: job.accountId, connection: job.connection,
        reads: { resume: library[i].data?.resume || waiting, played: library[i].data?.played || waiting, sessions: sessions[i].data || waiting } satisfies JellyfinMediaReads,
        busy: library[i].isFetching || sessions[i].isFetching,
        initialLoading: (library[i].isPending && library[i].isFetching) || (sessions[i].isPending && sessions[i].isFetching),
        error: library[i].isError || sessions[i].isError ? 'Could not unlock this connection. Reconnect to this server and user to restore access.' : '',
    })), [jobs, library, sessions])
    const refresh = useCallback(() => { for (const job of jobs) void mediaQueries.invalidateQueries({ queryKey: job.queryKey }) }, [jobs])
    return { results, refresh }
}
