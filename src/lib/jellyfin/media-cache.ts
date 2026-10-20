// Persisted, encrypted observations of successful Jellyfin library reads.
//
// The media query client in useJellyfinMedia is deliberately transient
// (gcTime 0, fresh per page load), so on a full reload every account card
// briefly renders a latest-watched title from another platform until the
// Jellyfin request settles. This cache restores the last SUCCESSFUL dated
// library observation per account+connection while the fresh read is in
// flight, so the card never falls back to the wrong platform's title.
//
// Invariants:
//   - only successful resume/played/archive reads are persisted, never
//     sessions and never credentials: a restored snapshot can never fabricate
//     live playing/paused state or reconnect anyone
//   - the payload is sealed with the vault's encryption key via the shared
//     encrypt/decrypt helpers, so no plaintext watch history is ever at rest
//   - storage follows the workspace-persisted localforage routing, so each
//     vault owner's observations live in that owner's database
//   - every payload records the exact subject scope (account, connection,
//     sealed credentials, verified remote user and server) and restores only
//     for an identical scope: a reconnect, user change or server change can
//     never inherit the previous subject's history
//   - restored observations are placeholders for pending reads only; a live
//     error replaces them, and honesty flags (complete/limited/total) are
//     preserved exactly as they were observed
//   - version and subject validation reject the whole payload; each read is
//     validated independently so a damaged section cannot discard healthy
//     siblings or be restored as a successful empty listing

import type { MediaRead } from './reads.ts'
import type { JellyfinItem, JellyfinItemResult } from './types.ts'

export const MEDIA_CACHE_PREFIX = 'aio_jf_media_v1'
const MEDIA_CACHE_VERSION = 1
/**
 * Mirrors the client's deterministic full-walk sanity bound (50,000 items):
 * the largest observation a honest read can produce. Not a product cutoff —
 * it exists so a corrupt payload cannot balloon memory.
 */
const MAX_ITEMS_PER_READ = 50_000

/** Message matching the waiting placeholder in useJellyfinMedia. */
export const MEDIA_READ_WAITING_MESSAGE = 'Reading this server for the verified user…'

/** The exact subject a cached observation belongs to. Every field must match. */
export interface MediaCacheScope {
    accountId: string
    connectionId: string
    /** Sealed credential blob (connection.credentials.jellyfin): the saved sign-in's identity. */
    credentials: string
    /** Verified remote user (connection.mediaServer.userId). */
    userId: string
    /** Verified remote server (connection.mediaServer.serverId, '' when unknown). */
    serverId: string
}

export interface MediaCacheReadObservation {
    items: JellyfinItem[]
    total: number | null
    complete: boolean
    paginationComplete?: true
    limited?: true
    limit: number
    /** When the server reported this read; restored reads keep this timestamp. */
    checkedAt: number
}

export interface MediaCacheObservation {
    resume?: MediaCacheReadObservation
    played?: MediaCacheReadObservation
    /** Last successful full-history walk (all played pages), head+archive merge source. */
    archive?: MediaCacheReadObservation
    savedAt: number
}

/** Sections of an observation a writer may update without touching the rest. */
export type MediaCacheObservationSections = Partial<Pick<MediaCacheObservation, 'resume' | 'played' | 'archive'>> & { savedAt?: number }

/** Injectable cipher bound to the active vault key. */
export interface MediaCacheCrypto {
    encrypt(plain: string): Promise<string>
    decrypt(sealed: string): Promise<string>
}

/** Loading only needs the decrypt half of a cipher. */
export type MediaCacheDecryptor = Pick<MediaCacheCrypto, 'decrypt'>

/** Injectable workspace-persisted key/value storage (localforage-compatible). */
export interface MediaCacheStorage {
    getItem(key: string): Promise<string | null>
    setItem(key: string, value: string): Promise<void>
    removeItem(key: string): Promise<void>
    keys(): Promise<string[]>
}

export function mediaCacheStorageKey(scope: { accountId: string; connectionId: string }): string {
    return `${MEDIA_CACHE_PREFIX}:${scope.accountId}:${scope.connectionId}`
}

export function sameMediaCacheScope(a: MediaCacheScope, b: MediaCacheScope): boolean {
    return a.accountId === b.accountId
    && a.connectionId === b.connectionId
    && a.credentials === b.credentials
    && a.userId === b.userId
    && a.serverId === b.serverId
}

function isCacheItem(value: unknown): value is JellyfinItem {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        && typeof (value as { Id?: unknown }).Id === 'string' && (value as { Id: string }).Id !== ''
}

function parseReadObservation(value: unknown): MediaCacheReadObservation | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
    const record = value as Record<string, unknown>
    if (!Array.isArray(record.items) || record.items.length > MAX_ITEMS_PER_READ) return undefined
    if (!record.items.every(isCacheItem)) return undefined
    const total = record.total
    if (!(total === null || (typeof total === 'number' && Number.isInteger(total) && total >= 0))) return undefined
    if (typeof record.complete !== 'boolean') return undefined
    if (record.paginationComplete !== undefined && record.paginationComplete !== true) return undefined
    if (record.limited !== undefined && record.limited !== true) return undefined
    // Partials are never persisted: a stored in-flight snapshot is corrupt.
    if (record.inProgress !== undefined) return undefined
    if (typeof record.limit !== 'number' || !Number.isInteger(record.limit) || record.limit <= 0) return undefined
    if (typeof record.checkedAt !== 'number' || !Number.isFinite(record.checkedAt) || record.checkedAt < 0) return undefined
    return {
        items: record.items,
        total,
        complete: record.complete,
        ...(record.paginationComplete === true ? { paginationComplete: true as const } : {}),
        ...(record.limited === true ? { limited: true as const } : {}),
        limit: record.limit,
        checkedAt: record.checkedAt,
    }
}

export function encodeMediaObservation(scope: MediaCacheScope, observation: MediaCacheObservation): string {
    return JSON.stringify({ v: MEDIA_CACHE_VERSION, scope, observation })
}

export function decodeMediaObservation(payload: string, scope: MediaCacheScope): MediaCacheObservation | null {
    let parsed: unknown
    try {
        parsed = JSON.parse(payload)
    } catch {
        return null
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const record = parsed as Record<string, unknown>
    if (record.v !== MEDIA_CACHE_VERSION) return null
    const sealed = record.scope
    if (typeof sealed !== 'object' || sealed === null || Array.isArray(sealed)) return null
    const sealedScope = sealed as Record<string, unknown>
    for (const field of ['accountId', 'connectionId', 'credentials', 'userId', 'serverId'] as const) {
        if (typeof sealedScope[field] !== 'string') return null
    }
    const candidateScope: MediaCacheScope = {
        accountId: sealedScope.accountId as string,
        connectionId: sealedScope.connectionId as string,
        credentials: sealedScope.credentials as string,
        userId: sealedScope.userId as string,
        serverId: sealedScope.serverId as string,
    }
    if (!sameMediaCacheScope(candidateScope, scope)) return null
    if (typeof record.observation !== 'object' || record.observation === null || Array.isArray(record.observation)) return null
    const raw = record.observation as Record<string, unknown>
    if (typeof raw.savedAt !== 'number' || !Number.isFinite(raw.savedAt) || raw.savedAt < 0) return null
    const resume = parseReadObservation(raw.resume)
    const played = parseReadObservation(raw.played)
    const archive = parseReadObservation(raw.archive)
    if (!resume && !played && !archive) return null
    return {
        ...(resume ? { resume } : {}),
        ...(played ? { played } : {}),
        ...(archive ? { archive } : {}),
        savedAt: raw.savedAt,
    }
}

/** Keeps only the successful reads of a live result; null when nothing succeeded. */
export function observedLibraryReads(reads: { resume: MediaRead<JellyfinItemResult>; played: MediaRead<JellyfinItemResult> }): MediaCacheObservation | null {
    const keep = (read: MediaRead<JellyfinItemResult>): MediaCacheReadObservation | undefined =>
        read.status === 'success'
            ? {
                items: read.data.items,
                total: read.data.total,
                complete: read.data.complete,
                ...(read.data.paginationComplete ? { paginationComplete: true as const } : {}),
                ...(read.data.limited ? { limited: true as const } : {}),
                limit: read.data.limit,
                checkedAt: read.checkedAt,
            }
            : undefined
    const resume = keep(reads.resume)
    const played = keep(reads.played)
    if (!resume && !played) return null
    return {
        ...(resume ? { resume } : {}),
        ...(played ? { played } : {}),
        savedAt: Date.now(),
    }
}

/** A successful full-walk read as an archive observation; null for anything else. */
export function observedArchiveRead(read: MediaRead<JellyfinItemResult>): MediaCacheReadObservation | undefined {
    return read.status === 'success'
        ? {
            items: read.data.items,
            total: read.data.total,
            complete: read.data.complete,
            ...(read.data.paginationComplete ? { paginationComplete: true as const } : {}),
            ...(read.data.limited ? { limited: true as const } : {}),
            limit: read.data.limit,
            checkedAt: read.checkedAt,
        }
        : undefined
}

/**
 * Section-wise merge for read-modify-write persistence: the new sections win,
 * sections the writer did not touch survive from the previous observation.
 * Null when nothing would remain.
 */
export function mergeMediaObservations(previous: MediaCacheObservation | undefined, next: MediaCacheObservationSections): MediaCacheObservation | null {
    const merged: MediaCacheObservation = {
        resume: next.resume ?? previous?.resume,
        played: next.played ?? previous?.played,
        archive: next.archive ?? previous?.archive,
        savedAt: next.savedAt ?? Date.now(),
    }
    return merged.resume || merged.played || merged.archive ? merged : null
}

/** Converts a restored observation into the read pair the activity pipeline consumes. */
export function restoredLibraryReads(observation: MediaCacheObservation): { resume: MediaRead<JellyfinItemResult>; played: MediaRead<JellyfinItemResult>; archive?: MediaRead<JellyfinItemResult> } | null {
    if (!observation.resume && !observation.played && !observation.archive) return null
    const restore = (obs: MediaCacheReadObservation): MediaRead<JellyfinItemResult> => ({
        status: 'success',
        data: {
            items: obs.items,
            total: obs.total,
            complete: obs.complete,
            ...(obs.paginationComplete ? { paginationComplete: true as const } : {}),
            ...(obs.limited ? { limited: true as const } : {}),
            limit: obs.limit,
        },
        checkedAt: obs.checkedAt,
    })
    return {
        resume: observation.resume ? restore(observation.resume) : { status: 'waiting', message: MEDIA_READ_WAITING_MESSAGE },
        played: observation.played ? restore(observation.played) : { status: 'waiting', message: MEDIA_READ_WAITING_MESSAGE },
        ...(observation.archive ? { archive: restore(observation.archive) } : {}),
    }
}

/**
 * A fresh head read still agrees with a full archive walk when the totals
 * match and the head's item ids are exactly the archive's first head.length
 * ids (as sets — order ties may shift). Order-insensitive on purpose; any
 * new, missing or reordered-beyond-recognition entry means the archive no
 * longer describes the current listing and must be re-walked.
 */
export function playedReadsReconcile(head: JellyfinItemResult, archive: JellyfinItemResult): boolean {
    if (head.total !== archive.total) return false
    const headIds = new Set(head.items.map(item => item.Id))
    if (headIds.size !== head.items.length) return false
    const archiveHeadIds = new Set(archive.items.slice(0, head.items.length).map(item => item.Id))
    if (archiveHeadIds.size !== head.items.length) return false
    for (const id of headIds) {
        if (!archiveHeadIds.has(id)) return false
    }
    return true
}

/**
 * Merges the fresh head read (first pages, refreshed on the fast poll) with
 * the archive read (full walk, bounded cadence) into the played read the
 * activity pipeline consumes. Honesty rules:
 *   - the head's product bound (the old 500 cutoff) is never surfaced: no
 *     `limited` flag is ever produced here
 *   - `complete` is claimed only when provable NOW: the fresh head already
 *     covered the whole claimed raw space, or the archive walk is complete
 *     AND the head still reconciles with it (same total, same head items)
 *   - a failed or contradictory side keeps the merged listing honestly
 *     incomplete; items shown are the freshest verifiable rows
 *   - head rows win over archive rows on id collisions (fresher UserData)
 */
export function mergePlayedReads(
    head: MediaRead<JellyfinItemResult> | undefined,
    archive: MediaRead<JellyfinItemResult> | undefined
): MediaRead<JellyfinItemResult> | undefined {
    if (!head) return archive
    // A live head failure is never masked by older data: the error read
    // surfaces exactly as it would without an archive.
    if (head.status !== 'success') return head
    if (!archive) {
        // Full walk pending or unavailable: show the fresh head without the
        // product cap; complete only when the head itself covered everything.
        return { status: 'success', data: { items: head.data.items, total: head.data.total, complete: head.data.complete, limit: head.data.limit }, checkedAt: head.checkedAt }
    }
    if (archive.status !== 'success') {
        // The full walk failed: the head is all that is verifiable right now.
        return { status: 'success', data: { items: head.data.items, total: head.data.total, complete: false, limit: head.data.limit }, checkedAt: head.checkedAt }
    }
    if (head.data.complete) {
        // The fresh head alone proved the whole listing (small libraries):
        // a retained archive tail would only be stale rows.
        return { status: 'success', data: { items: head.data.items, total: head.data.total, complete: true, limit: head.data.limit }, checkedAt: head.checkedAt }
    }
    const headIds = new Set(head.data.items.map(item => item.Id))
    const reconciles = playedReadsReconcile(head.data, archive.data)
    const items = [...head.data.items, ...archive.data.items.filter(item => !headIds.has(item.Id))]
    return {
        status: 'success',
        data: {
            items,
            total: head.data.total ?? archive.data.total,
            complete: reconciles && archive.data.complete,
            ...(reconciles && archive.data.paginationComplete ? { paginationComplete: true as const } : {}),
            limit: archive.data.limit,
        },
        checkedAt: head.checkedAt,
    }
}

/**
 * Loads the sealed observation for one scope. Returns null for a missing key,
 * a foreign vault's ciphertext, storage failure or any malformed payload: a
 * cache miss only means this reload waits for the live read.
 */
export async function loadMediaObservation(storage: MediaCacheStorage, decrypt: MediaCacheDecryptor, scope: MediaCacheScope): Promise<MediaCacheObservation | null> {
    let sealed: string | null
    try {
        sealed = await storage.getItem(mediaCacheStorageKey(scope))
    } catch {
        return null
    }
    if (typeof sealed !== 'string' || sealed === '') return null
    let payload: string
    try {
        payload = await decrypt.decrypt(sealed)
    } catch {
        return null
    }
    return decodeMediaObservation(payload, scope)
}

/** Keys of this cache's namespace that no live scope owns anymore. */
export function orphanedMediaCacheKeys(storedKeys: string[], liveKeys: string[]): string[] {
    const live = new Set(liveKeys)
    return storedKeys.filter(key => key.startsWith(`${MEDIA_CACHE_PREFIX}:`) && !live.has(key))
}
