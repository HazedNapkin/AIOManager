import { useEffect, useMemo, useRef, useState } from 'react'
import type { ActivityItem } from '@/types/activity'
import { fetchCinemetaDetail } from '@/lib/cinemeta-cache'
import { fetchKitsuMeta } from '@/lib/kitsu-meta'
import { applyResolvedMetadataOverlay, collectUnresolvedMetadataTargets, type ResolvedMetadata } from '@/lib/activity-metadata-overlay'

const FAILED_LOOKUP_TTL_MS = 5 * 60 * 1000

/** Fill unresolved feed titles without letting failed lookups block later rows. */
export function useActivityMetadata(items: ActivityItem[]): ActivityItem[] {
    const [resolved, setResolved] = useState<Map<string, ResolvedMetadata>>(() => new Map())
    const attemptedAt = useRef(new Map<string, number>())
    const [completedPass, setCompletedPass] = useState(0)

    useEffect(() => {
        const now = Date.now()
        const batch = collectUnresolvedMetadataTargets(items, resolved)
            .filter(target => now - (attemptedAt.current.get(target.itemId) ?? -Infinity) >= FAILED_LOOKUP_TTL_MS)
            .slice(0, 10)
        if (batch.length === 0) return
        let active = true
        const types = new Map(items.map(item => [item.itemId, item.type]))
        Promise.all(batch.map(async (target): Promise<ResolvedMetadata | null> => {
            try {
                if (target.kind === 'imdb') {
                    const meta = await fetchCinemetaDetail(target.itemId, types.get(target.itemId))
                    if (!meta?.name) return null
                    const genres = meta.genre?.split(',').map(genre => genre.trim()).filter(Boolean)
                    return { name: meta.name, poster: meta.poster, genres: genres?.length ? genres : undefined }
                }
                const meta = await fetchKitsuMeta(target.kitsuId)
                return meta?.name ? { name: meta.name, poster: meta.poster, genres: meta.genres } : null
            } catch {
                return null
            }
        })).then(results => {
            if (!active) return
            const resolutions = new Map<string, ResolvedMetadata>()
            batch.forEach((target, index) => {
                attemptedAt.current.set(target.itemId, Date.now())
                if (results[index]) resolutions.set(target.itemId, results[index])
            })
            if (resolutions.size > 0) {
                setResolved(previous => new Map([...previous, ...resolutions]))
            } else {
                // An entirely failed batch still advances to the remaining titles.
                setCompletedPass(pass => pass + 1)
            }
        })
        return () => { active = false }
    }, [items, resolved, completedPass])

    return useMemo(() => applyResolvedMetadataOverlay(items, resolved), [items, resolved])
}
