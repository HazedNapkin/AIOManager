// Pure planner for surgical per-episode Stremio deletes: every transient or structural
// failure fails closed instead of escalating to an irreversible whole-show removal.
import type { LibraryItem } from '../types/activity.ts'
import type { MetaVideo } from './watched-episodes.ts'
import { decodeWatchedBitfield, encodeWatchedBitfield } from './watched-bitfield.ts'

export type EpisodeDeletePlan =
    | { kind: 'rewrite'; rewritten: LibraryItem }
    | { kind: 'remove-row' }
    | { kind: 'skip' }
    | { kind: 'fail'; reason: 'no-videos' | 'no-bitfield' | 'anchor-mismatch' | 'episode-not-watched' | 'non-tt' }

export async function planEpisodeBitfieldDelete(args: {
    itemId: string
    row: LibraryItem | undefined
    videos: MetaVideo[] | null
    target: { uniqueItemId?: string; season: number | null; episode: number | null }
}): Promise<EpisodeDeletePlan> {
    const { itemId, row, videos, target } = args
    // Non-tt ids (kitsu/mal/anidb) can never resolve a Cinemeta video list.
    if (!itemId.startsWith('tt')) return { kind: 'fail', reason: 'non-tt' }
    // Row absent remotely: nothing to delete remotely, the local purge handles the feed entry.
    if (!row) return { kind: 'skip' }
    if (videos == null) return { kind: 'fail', reason: 'no-videos' }

    const decoded = await decodeWatchedBitfield(row.state?.watched)
    // An empty bitfield is "no data", not "nothing watched" — destroying the row would lose real state.
    if (!decoded || decoded.watchedIndices.length === 0) return { kind: 'fail', reason: 'no-bitfield' }

    const maxWatched = videos[decoded.watchedIndices[decoded.watchedIndices.length - 1]]
    if (!maxWatched || maxWatched.id !== decoded.videoId) return { kind: 'fail', reason: 'anchor-mismatch' }

    const targetIdx = decoded.watchedIndices.find(i => {
        const v = videos[i]
        if (!v) return false
        return (target.uniqueItemId && v.id === target.uniqueItemId) || (v.season === target.season && v.episode === target.episode)
    })
    if (targetIdx === undefined) return { kind: 'fail', reason: 'episode-not-watched' }

    const remaining = decoded.watchedIndices.filter(i => i !== targetIdx)
    if (remaining.length === 0) return { kind: 'remove-row' }

    const anchor = videos[remaining[remaining.length - 1]]
    const watched = await encodeWatchedBitfield(remaining, anchor.id, decoded.length)
    const rewritten: LibraryItem = {
        ...row,
        state: {
            ...row.state,
            watched,
            video_id: anchor.id,
            season: anchor.season ?? undefined,
            episode: anchor.episode ?? undefined,
            timesWatched: remaining.length,
        },
    }
    return { kind: 'rewrite', rewritten }
}
