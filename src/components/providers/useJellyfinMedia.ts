import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { QueryClient, useQueries, type UseQueryResult } from '@tanstack/react-query'
import { useAccountStore } from '@/store/accountStore'
import { useAuthStore } from '@/store/authStore'
import { useConnectionStore } from '@/store/connectionStore'
import { encrypt, decrypt } from '@/lib/crypto'
import { getActivePersistence, getActiveWorkspaceId, subscribeWorkspaceChanges } from '@/lib/workspace-persistence'
import { createJellyfinClient } from '@/lib/jellyfin/client'
import { openJellyfinSecret } from '@/lib/jellyfin/connection-data'
import {
    MEDIA_READ_WAITING_MESSAGE,
    loadMediaObservation,
    mediaCacheStorageKey,
    sealMediaObservationSections,
    mergePlayedReads,
    observedArchiveRead,
    observedLibraryReads,
    orphanedMediaCacheKeys,
    playedReadsReconcile,
    restoredLibraryReads,
    sameMediaCacheScope,
    type MediaCacheObservationSections,
    type MediaCacheReadObservation,
    type MediaCacheScope,
    type MediaCacheStorage,
} from '@/lib/jellyfin/media-cache'
import { captureMediaRead, type JellyfinMediaReads, type MediaRead } from '@/lib/jellyfin/reads'
import { resolveJellyfinSeries } from '@/lib/jellyfin/metadata'
import { canApplyMediaReadFailure, jellyfinConnectionReadFailure } from '@/lib/jellyfin/connection-health'
import type { JellyfinItem, JellyfinItemResult, JellyfinSession } from '@/lib/jellyfin/types'
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
const waiting = { status: 'waiting' as const, message: MEDIA_READ_WAITING_MESSAGE }
function combine<T>(queries: UseQueryResult<T>[]) {
    // TanStack structurally shares each combined child. Fetch status can change
    // without replacing the data/error arrays used by Activity derivation.
    return {
        data: queries.map(query => query.data),
        fetching: queries.map(query => query.isFetching),
        pending: queries.map(query => query.isPending),
        errors: queries.map(query => query.isError),
    }
}
type LibraryReads = Pick<JellyfinMediaReads, 'resume' | 'played'>
/** Restored observations additionally carry the last full-history archive walk. */
type RestoredLibraryReads = LibraryReads & { archive?: MediaRead<JellyfinItemResult> }
function libraryItems(reads: LibraryReads | undefined): JellyfinItem[] {
    return reads ? [reads.resume, reads.played].flatMap(read => read.status === 'success' ? read.data.items : []) : []
}

/**
 * Full-history archive cadence: the fast 60s poll only refreshes the head
 * (resume + first played pages), while the full walk reconciles deletions and
 * the archive tail at this bounded cadence, on manual refresh, and whenever
 * the head stops reconciling with the retained archive.
 */
const ARCHIVE_REFRESH_MS = 10 * 60_000

// ---------------------------------------------------------------------------
// Persisted library observations (see lib/jellyfin/media-cache).
//
// The media query client above is transient on purpose, so a full page reload
// restores the last successful per-connection observation from encrypted,
// workspace-scoped storage while the fresh read is in flight. Restored reads
// are placeholders for pending reads only — a live error replaces them — and
// they are keyed by vault epoch plus the exact subject scope, so a vault
// lock/unlock, workspace transition, reconnect, user change or server change
// can never restore another subject's history.
// ---------------------------------------------------------------------------

function captureMediaCacheStorage(): MediaCacheStorage {
    // Pin the database before any await. A workspace switch must not redirect
    // an old request's encrypted observation into the new owner's database.
    const persistence = getActivePersistence()
    return {
        getItem: async key => { const value = await persistence.getItem(key); return typeof value === 'string' ? value : null },
        setItem: (key, value) => persistence.setItem(key, value),
        removeItem: key => persistence.removeItem(key),
        keys: () => persistence.keys(),
    }
}

interface RestoredMediaCache { epoch: number; reads: Map<string, RestoredLibraryReads>; completed: Set<string> }
const emptyRestoredMediaCache: RestoredMediaCache = { epoch: -1, reads: new Map(), completed: new Set() }
let restoredMediaCache: RestoredMediaCache = emptyRestoredMediaCache
let hydrationGeneration = 0
const pendingHydrations = new Set<string>()
/** Cooldown bookkeeping for head/archive reconcile triggers (per subject key). */
const archiveReconcileAt = new Map<string, number>()
const hydrationListeners = new Set<() => void>()
function publishRestoredMediaCache(next: RestoredMediaCache) {
    restoredMediaCache = next
    hydrationListeners.forEach(listener => listener())
}
const subscribeHydration = (listener: () => void) => {
    hydrationListeners.add(listener)
    return () => { hydrationListeners.delete(listener) }
}
// A workspace transition invalidates everything: in-flight hydration ends
// without publishing, and restored observations never cross vault owners.
function clearRestoredMediaCache() {
    hydrationGeneration++
    pendingHydrations.clear()
    publishRestoredMediaCache(emptyRestoredMediaCache)
}
subscribeWorkspaceChanges(clearRestoredMediaCache)
useAuthStore.subscribe((state, previous) => {
    if (state.encryptionKey !== previous.encryptionKey) clearRestoredMediaCache()
})

function mediaScopeFor(job: { accountId: string; connection: Connection }): MediaCacheScope | null {
    const credentials = job.connection.credentials?.jellyfin
    const userId = job.connection.mediaServer?.userId
    if (!credentials || !userId) return null
    return {
        accountId: job.accountId,
        connectionId: job.connection.id,
        credentials,
        userId,
        serverId: job.connection.mediaServer?.serverId || '',
    }
}

function restorationKey(scope: MediaCacheScope, vaultEpoch: number): string {
    return [vaultEpoch, scope.accountId, scope.connectionId, scope.credentials, scope.userId, scope.serverId].join('|')
}

function restorationKeyForJob(job: { accountId: string; connection: Connection; encryptionKey: CryptoKey }): string {
    const scope = mediaScopeFor(job)
    return scope ? restorationKey(scope, epoch(job.encryptionKey)) : ''
}

interface MediaCacheJob { accountId: string; connection: Connection; encryptionKey: CryptoKey; workspaceId: string; storage: MediaCacheStorage }
function cacheJobIsCurrent(job: MediaCacheJob, scope: MediaCacheScope): boolean {
    if (useAuthStore.getState().encryptionKey !== job.encryptionKey || getActiveWorkspaceId() !== job.workspaceId) return false
    const account = useAccountStore.getState().accounts.find(item => item.id === job.accountId)
    const connection = account?.connections?.find(item => item.id === job.connection.id && item.enabled !== false)
    const currentScope = connection ? mediaScopeFor({ accountId: job.accountId, connection }) : null
    return !!currentScope && sameMediaCacheScope(currentScope, scope)
}

async function hydrateMediaCache(jobs: MediaCacheJob[], vaultEpoch: number): Promise<void> {
    const generation = hydrationGeneration
    const reads = new Map<string, RestoredLibraryReads>()
    const completed = new Set<string>()
    for (const job of jobs) {
        const scope = mediaScopeFor(job)
        if (!scope) continue
        const jobKey = restorationKey(scope, vaultEpoch)
        try {
            const observation = await loadMediaObservation(job.storage, { decrypt: sealed => decrypt(sealed, job.encryptionKey) }, scope)
            const restored = observation ? restoredLibraryReads(observation) : null
            if (restored && cacheJobIsCurrent(job, scope)) reads.set(jobKey, restored)
        } catch {
            // Unreadable observation: this subject waits for its live read.
        }
        if (generation !== hydrationGeneration) return
        completed.add(jobKey)
        pendingHydrations.delete(jobKey)
    }
    if (generation !== hydrationGeneration) return
    // Several cards can mount independently. Merge their hydration results so
    // the first card does not mark every other account as already hydrated.
    const previous = restoredMediaCache.epoch === vaultEpoch ? restoredMediaCache : emptyRestoredMediaCache
    publishRestoredMediaCache({ epoch: vaultEpoch, reads: new Map([...previous.reads, ...reads]), completed: new Set([...previous.completed, ...completed]) })
}

const mediaCacheWrites = new Map<string, Promise<void>>()
function persistMediaSections(job: MediaCacheJob, scope: MediaCacheScope, sections: MediaCacheObservationSections): Promise<void> {
    const queueKey = JSON.stringify([job.workspaceId, scope.accountId, scope.connectionId])
    const pending = (mediaCacheWrites.get(queueKey) ?? Promise.resolve()).then(() => persistMediaSectionsNow(job, scope, sections))
    mediaCacheWrites.set(queueKey, pending)
    void pending.finally(() => { if (mediaCacheWrites.get(queueKey) === pending) mediaCacheWrites.delete(queueKey) })
    return pending
}

async function persistMediaSectionsNow(job: MediaCacheJob, scope: MediaCacheScope, sections: MediaCacheObservationSections): Promise<void> {
    const key = job.encryptionKey
    const generation = hydrationGeneration
    try {
        if (!cacheJobIsCurrent(job, scope)) return
        // Serialize read-modify-write for this subject: head and archive writes
        // must see the last committed sections instead of racing from one base.
        const stored = await job.storage.getItem(mediaCacheStorageKey(scope))
        if (!cacheJobIsCurrent(job, scope) || generation !== hydrationGeneration) return
        const sealed = await sealMediaObservationSections(stored, {
            encrypt: plain => encrypt(plain, key),
            decrypt: encrypted => decrypt(encrypted, key),
        }, scope, sections)
        if (!sealed) return
        // Reject late writes: if the vault re-locked or the workspace switched
        // while sealing, this observation belongs to another owner's session
        // and must never land in the active workspace's storage.
        if (!cacheJobIsCurrent(job, scope) || generation !== hydrationGeneration) return
        await job.storage.setItem(mediaCacheStorageKey(scope), sealed)
        // Prune entries whose account/connection no longer exists so deleted
        // or removed subjects never accumulate (and can never be revived).
        const liveKeys = useAccountStore.getState().accounts.flatMap(account =>
            (account.connections || [])
                .filter(connection => connection.platform === 'jellyfin')
                .map(connection => mediaCacheStorageKey({ accountId: account.id, connectionId: connection.id }))
        )
        for (const orphan of orphanedMediaCacheKeys(await job.storage.keys(), liveKeys)) {
            if (!cacheJobIsCurrent(job, scope) || generation !== hydrationGeneration) return
            await job.storage.removeItem(orphan)
        }
    } catch {
        // Best-effort cache: the live read this observation came from already succeeded.
    }
}

function archiveResultOf(observation: MediaCacheReadObservation): JellyfinItemResult {
    return {
        items: observation.items,
        total: observation.total,
        complete: observation.complete,
        ...(observation.paginationComplete ? { paginationComplete: true as const } : {}),
        ...(observation.limited ? { limited: true as const } : {}),
        limit: observation.limit,
    }
}
export interface JellyfinMediaScope { accountId: string; connection: Connection }

export function refreshJellyfinMedia(accountId: string, connectionId: string): void {
    void mediaQueries.invalidateQueries({ queryKey: ['jellyfin-media', accountId, connectionId] })
}

export function useJellyfinMediaConnections(scopes: JellyfinMediaScope[]) {
    const encryptionKey = useAuthStore(state => state.encryptionKey)
    const workspaceId = useSyncExternalStore(subscribeWorkspaceChanges, getActiveWorkspaceId, () => '')
    const isVisible = useSyncExternalStore(subscribeVisibility, visible, () => false)
    useEffect(() => { mediaQueries.mount(); return () => mediaQueries.unmount() }, [])
    const jobs = useMemo(() => {
        if (!encryptionKey || !isVisible) return []
        const storage = captureMediaCacheStorage()
        return scopes
        .filter(({ connection }) => connection.platform === 'jellyfin' && connection.enabled && connection.credentials?.jellyfin && connection.mediaServer?.userId)
        .map(scope => ({ ...scope, encryptionKey, workspaceId, storage, queryKey: ['jellyfin-media', scope.accountId, scope.connection.id, epoch(encryptionKey), scope.connection.credentials.jellyfin, scope.connection.mediaServer!.userId, scope.connection.mediaServer?.serverId || '', workspaceId] }))
    }, [scopes, encryptionKey, isVisible, workspaceId])
    const vaultEpoch = encryptionKey ? epoch(encryptionKey) : -1
    const hydration = useSyncExternalStore(subscribeHydration, () => restoredMediaCache, () => emptyRestoredMediaCache)
    useEffect(() => {
        if (!encryptionKey || jobs.length === 0) return
        const missing = jobs.filter(job => {
            const jobKey = restorationKeyForJob(job)
            return !pendingHydrations.has(jobKey) && (hydration.epoch !== vaultEpoch || !hydration.completed.has(jobKey))
        })
        if (!missing.length) return
        missing.forEach(job => pendingHydrations.add(restorationKeyForJob(job)))
        void hydrateMediaCache(missing, vaultEpoch).catch(() => {})
    }, [encryptionKey, jobs, hydration, vaultEpoch])
    const library = useQueries({ queries: jobs.map(job => ({
        queryKey: [...job.queryKey, 'library'], refetchInterval: job.connection.status === 'expired' ? false : 60_000,
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
            const persistScope = mediaScopeFor(job)
            const persisted = persistScope ? observedLibraryReads({ resume, played }) : null
            if (persistScope && persisted) void persistMediaSections(job, persistScope, persisted)
            return { resume, played }
        },
    })), combine }, mediaQueries)
    // Full-history archive walk: the 60s poll above only refreshes the head,
    // so the complete listing (and deletion reconciliation) happens here — on
    // first load, at a bounded cadence, on manual refresh, and whenever the
    // head stops reconciling with the retained archive. Pages publish
    // progressively (inProgress snapshots) so history is usable mid-walk.
    const archive = useQueries({ queries: jobs.map((job, i) => ({
        queryKey: [...job.queryKey, 'archive'],
        // Wait for the head: the reuse check below needs it, and a reload with
        // a fresh reconciling cache then skips the walk entirely.
        enabled: !!library.data[i],
        refetchInterval: job.connection.status === 'expired' ? false : ARCHIVE_REFRESH_MS,
        staleTime: ARCHIVE_REFRESH_MS,
        queryFn: async ({ signal }: { signal: AbortSignal }) => {
            const secret = await openJellyfinSecret(job.connection, value => decrypt(value, job.encryptionKey))
            signal.throwIfAborted()
            const client = createJellyfinClient(secret.baseUrl, { deviceId: secret.deviceId })
            const archiveKey = [...job.queryKey, 'archive']
            const libraryNow = mediaQueries.getQueryData<LibraryReads>([...job.queryKey, 'library'])
            const headNow = libraryNow?.played
            const priorArchive = mediaQueries.getQueryData<JellyfinMediaReads['played']>(archiveKey)
            const scope = mediaScopeFor(job)
            if (scope && !priorArchive) {
                // A fresh persisted walk that still reconciles with the live
                // head is provably current: reuse it instead of re-walking
                // thousands of rows on a fresh mount. A settled query must
                // walk again when explicitly refreshed or invalidated; reusing
                // the same stored archive there would swallow manual refreshes.
                // Bounded cache reuse, never a cap: any
                // divergence (e.g. cached total 1 vs head total 2027) falls
                // through to a full walk.
                const stored = await loadMediaObservation(job.storage, { decrypt: sealed => decrypt(sealed, job.encryptionKey) }, scope)
                signal.throwIfAborted()
                const storedArchive = stored?.archive
                if (storedArchive
                    && Date.now() - storedArchive.checkedAt < ARCHIVE_REFRESH_MS
                    && headNow?.status === 'success' && playedReadsReconcile(headNow.data, archiveResultOf(storedArchive))) {
                    return { status: 'success', data: archiveResultOf(storedArchive), checkedAt: storedArchive.checkedAt } satisfies JellyfinMediaReads['played']
                }
            }
            const resolvedSoFar: JellyfinItem[] = []
            const seed = [
                ...libraryItems(libraryNow),
                ...(priorArchive?.status === 'success' ? priorArchive.data.items : []),
            ]
            const read = await captureMediaRead(() => client.readAllPlayed(secret.accessToken, secret.userId, {
                onProgress: async snapshot => {
                    // Resolve this page's episodes against everything already
                    // resolved (bounded per page) so identities stay stable at
                    // the head/archive boundary, then publish the partial.
                    const page = snapshot.items.slice(resolvedSoFar.length)
                    const resolvedPage = await resolveJellyfinSeries(page, (id, metadataSignal) => client.readItem(secret.accessToken, secret.userId, id, metadataSignal), signal, [...seed, ...resolvedSoFar])
                    resolvedSoFar.push(...resolvedPage)
                    const partial: JellyfinMediaReads['played'] = { status: 'success', data: { ...snapshot, items: [...resolvedSoFar] }, checkedAt: Date.now() }
                    mediaQueries.setQueryData(archiveKey, partial)
                },
            }, signal), signal)
            if (read.status === 'success') {
                read.data = resolvedSoFar.length === read.data.items.length ? { ...read.data, items: resolvedSoFar } : read.data
                const persistScope = mediaScopeFor(job)
                const persistedArchive = persistScope ? observedArchiveRead(read) : undefined
                if (persistScope && persistedArchive) void persistMediaSections(job, persistScope, { archive: persistedArchive })
            }
            return read
        },
    })), combine }, mediaQueries)
    const sessions = useQueries({ queries: jobs.map(job => ({
        queryKey: [...job.queryKey, 'sessions'], refetchInterval: job.connection.status === 'expired' ? false : 15_000,
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
    // Session polls update live playback independently of the library/archive.
    // Keep the played union stable until one of its own inputs changes.
    const libraryResults = useMemo(() => jobs.map((job, i) => {
        // A restored observation only stands in for a read that is still on
        // its way: once the live result (success OR failure per read) or a
        // query-level error arrives, it replaces the placeholder, so API
        // uncertainty stays honest and no error is ever masked by old data.
        const observation = hydration.reads.get(restorationKeyForJob(job))
        const restored = !library.data[i] && !library.errors[i] ? observation : undefined
        // The head and archive settle independently. Keep the restored archive
        // through the gap after the head lands, until its own query settles.
        const restoredArchive = !archive.data[i] && !archive.errors[i] ? observation?.archive : undefined
        const head = library.data[i]?.played || restored?.played || waiting
        const archiveRead = archive.data[i] || restoredArchive
        // The exposed played listing merges the fresh head with the archive
        // walk. The removed 500 product cutoff never surfaces here; the only
        // completeness claims are the provable ones (see mergePlayedReads).
        const mergedPlayed = mergePlayedReads(head.status === 'waiting' ? undefined : head, archiveRead)
        // In-flight archive walks (partial snapshots, or the gap before the
        // first page lands once the head exists) are explicit progress, not a
        // settled incomplete listing: mark them so warnings wait for the walk
        // to settle. A settled verdict of any kind — live data, live error, or
        // a restored observation — is honest immediately and never suppressed.
        const archiveVerdict = !!archive.data[i] || !!archive.errors[i] || !!restoredArchive
        const archiveWalking = (archiveRead?.status === 'success' && archiveRead.data.inProgress === true)
            || (!archiveVerdict && (archive.fetching[i] === true || !!library.data[i]))
        const played = mergedPlayed && mergedPlayed.status === 'success' && archiveWalking
            ? { ...mergedPlayed, data: { ...mergedPlayed.data, inProgress: true as const } }
            : mergedPlayed ?? waiting
        return {
            accountId: job.accountId, connection: job.connection,
            reads: {
                resume: library.data[i]?.resume || restored?.resume || waiting,
                played,
            } satisfies LibraryReads,
            error: library.errors[i] ? 'Could not unlock this connection. Reconnect to this server and user to restore access.' : '',
        }
    }), [jobs, library.data, library.errors, archive.data, archive.errors, archive.fetching, hydration])
    const results = useMemo(() => libraryResults.map((result, i) => ({
        ...result,
        reads: { ...result.reads, sessions: sessions.data[i] || waiting } satisfies JellyfinMediaReads,
        error: result.error || (sessions.errors[i] ? 'Could not unlock this connection. Reconnect to this server and user to restore access.' : ''),
    })), [libraryResults, sessions.data, sessions.errors])
    useEffect(() => {
        for (const result of results) {
            const failure = jellyfinConnectionReadFailure(result.reads)
            const connection = result.connection
            if (!failure || connection.status === failure.status && connection.lastError === failure.message) continue
            const session = {
                credentials: connection.credentials.jellyfin, userId: connection.mediaServer!.userId,
                serverId: connection.mediaServer?.serverId, checkedAt: failure.checkedAt, startedAt: failure.startedAt,
            }
            if (!canApplyMediaReadFailure(connection, session)) continue
            void useConnectionStore.getState().updateConnection(result.accountId, connection.id, {
                status: failure.status, lastError: failure.message, lastErrorAt: failure.checkedAt,
            }, session).catch(() => {})
        }
    }, [results])
    // Head/archive reconciliation: when the fresh head stops reconciling with
    // the retained archive (new watches grew the total, deletions or reorders
    // changed the head region), re-walk the archive soon instead of waiting
    // for the cadence — cooldown-bounded so a persistently divergent upstream
    // cannot loop the walk.
    useEffect(() => {
        for (let i = 0; i < jobs.length; i++) {
            const head = library.data[i]?.played
            const full = archive.data[i]
            if (head?.status !== 'success' || full?.status !== 'success' || full.data.inProgress || archive.fetching[i]) continue
            if (playedReadsReconcile(head.data, full.data)) continue
            const key = restorationKeyForJob(jobs[i])
            const now = Date.now()
            if (now - (archiveReconcileAt.get(key) ?? 0) < 60_000) continue
            archiveReconcileAt.set(key, now)
            void mediaQueries.invalidateQueries({ queryKey: [...jobs[i].queryKey, 'archive'] })
        }
    }, [jobs, library.data, archive.data, archive.fetching])
    const refresh = useCallback(() => { for (const job of jobs) void mediaQueries.invalidateQueries({ queryKey: job.queryKey }) }, [jobs])
    const busy = jobs.some((_, i) => library.fetching[i] || sessions.fetching[i] || archive.fetching[i])
    // Media reads count as initial-loading until the fresh fetch resolves OR
    // the persisted observation hydration for this vault epoch settles, so
    // consumers can gate on it instead of flashing another platform's title.
    const hydrationPending = jobs.some(job => hydration.epoch !== vaultEpoch || !hydration.completed.has(restorationKeyForJob(job)))
    const initialLoading = jobs.some((_, i) => (library.pending[i] && library.fetching[i]) || (sessions.pending[i] && sessions.fetching[i])) || hydrationPending
    return { results, refresh, busy, initialLoading }
}
