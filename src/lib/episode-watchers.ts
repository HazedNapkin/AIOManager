// Household-wide episode attribution uses positive completion evidence only.
// One managed account appears once even when several connections watched it.
// Deleted accounts and hideLastWatched opt-outs never contribute an avatar.

import { maskEmailLevel, maskNameLevel } from './utils.ts'

/** Minimal structural slice of a watch-history row (HistoryEntry satisfies this). */
export interface EpisodeWatcherEvidence {
    itemId: string
    accountId: string
    season?: number
    episode?: number
    /** Watch time; Date or epoch ms. */
    timestamp: number | Date
    duration: number
    progress: number
    flaggedWatched?: number
    backfill?: boolean
}

/** Minimal structural slice of a managed account. */
export interface EpisodeWatcherAccountLike {
    id: string
    name?: string
    email?: string
    emoji?: string
    avatar?: string
    hideLastWatched?: boolean
}

export interface EpisodeWatcher {
    /** Managed account id (dedupe key across connections). */
    id: string
    /** Privacy-masked display name, ready for avatar fallbacks and labels. */
    name: string
    emoji?: string
    avatar?: string
    /** Most recent qualifying watch time, epoch ms (ordering only). */
    lastWatchedMs: number
}

/** season -> episode -> watchers (deduped, stably ordered, uncapped). */
export type EpisodeWatcherIndex = ReadonlyMap<number, ReadonlyMap<number, ReadonlyArray<EpisodeWatcher>>>

/** Visible avatar budget per episode row; overflow renders as an exact "+N" chip. */
export const EPISODE_WATCHER_AVATAR_CAP = 3

/** Names kept in the accessible/title label; larger stacks collapse to "and N more". */
export const EPISODE_WATCHER_LABEL_NAME_CAP = 6

/**
 * Positive completion evidence only. Mirrors the criterion that gates the season
 * browser's watched checkmarks — do not widen it without updating both call sites.
 */
export function hasConfirmedEpisodeWatchEvidence(e: EpisodeWatcherEvidence): boolean {
    if (e.backfill === true) return true
    if ((e.flaggedWatched ?? 0) > 0) return true
    return e.duration > 0 && e.progress >= 95
}

/** An anchor is usable only when it names a real (season, episode) slot. */
export function hasValidEpisodeAnchor(e: { season?: number; episode?: number }): e is { season: number; episode: number } {
    return e.season != null && e.episode != null
        && Number.isInteger(e.season) && Number.isInteger(e.episode)
        && e.episode >= 1
}

// Match the account switcher's name/email masking without importing UI components.
function maskedWatcherName(name: string | undefined, email: string | undefined, level: number): string {
    if (name && !name.includes('@')) return maskNameLevel(name, level)
    const emailStr = name && name.includes('@') ? name : (email || '')
    return maskEmailLevel(emailStr, level) || name || email || ''
}

/**
 * Collect the series in one history pass, then order each episode's distinct
 * watchers. Rows use direct lookups without scanning history or accounts.
 */
export function buildEpisodeWatcherIndex(options: {
    itemId: string | null | undefined
    history: readonly EpisodeWatcherEvidence[]
    accounts: readonly EpisodeWatcherAccountLike[]
    privacyLevelNames?: number
}): EpisodeWatcherIndex {
    const { itemId, history, accounts, privacyLevelNames = 0 } = options
    if (!itemId) return new Map()

    const accountById = new Map(accounts.map(a => [a.id, a]))

    // season -> episode -> accountId -> watcher (dedupe across connections,
    // keeping the most recent qualifying timestamp per account).
    const index = new Map<number, Map<number, Map<string, EpisodeWatcher>>>()
    for (const e of history) {
        if (e.itemId !== itemId) continue
        if (!hasValidEpisodeAnchor(e)) continue
        if (!hasConfirmedEpisodeWatchEvidence(e)) continue
        const acc = accountById.get(e.accountId)
        if (!acc || acc.hideLastWatched) continue
        const ts = e.timestamp instanceof Date ? e.timestamp.getTime() : e.timestamp
        const lastWatchedMs = Number.isFinite(ts) ? ts : 0
        const name = maskedWatcherName(acc.name, acc.email, privacyLevelNames) || 'Account'
        let byEpisode = index.get(e.season)
        if (!byEpisode) {
            byEpisode = new Map()
            index.set(e.season, byEpisode)
        }
        let byAccount = byEpisode.get(e.episode)
        if (!byAccount) {
            byAccount = new Map()
            byEpisode.set(e.episode, byAccount)
        }
        const prev = byAccount.get(e.accountId)
        if (!prev || lastWatchedMs >= prev.lastWatchedMs) {
            byAccount.set(e.accountId, {
                id: e.accountId,
                name,
                emoji: acc.emoji,
                avatar: acc.avatar,
                lastWatchedMs,
            })
        }
    }

    // Flatten with a deterministic order: most recent watch first, account id
    // as the tiebreak, so equal-timestamp inputs render identically.
    const flattened = new Map<number, ReadonlyMap<number, ReadonlyArray<EpisodeWatcher>>>()
    for (const [season, byEpisode] of index) {
        const out = new Map<number, ReadonlyArray<EpisodeWatcher>>()
        for (const [episode, byAccount] of byEpisode) {
            out.set(episode, [...byAccount.values()].sort((a, b) =>
                b.lastWatchedMs - a.lastWatchedMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
            ))
        }
        flattened.set(season, out)
    }
    return flattened
}

/**
 * Accessible/title label for a watcher stack. Bounded regardless of watcher
 * count: at most EPISODE_WATCHER_LABEL_NAME_CAP names, then "and N more".
 */
export function episodeWatcherLabel(watchers: ReadonlyArray<EpisodeWatcher>): string {
    if (watchers.length === 0) return ''
    const listed = watchers.slice(0, EPISODE_WATCHER_LABEL_NAME_CAP).map(w => w.name)
    const extra = watchers.length - listed.length
    const names = extra > 0 ? `${listed.join(', ')} and ${extra} more` : listed.join(', ')
    return `Watched by ${names}`
}
