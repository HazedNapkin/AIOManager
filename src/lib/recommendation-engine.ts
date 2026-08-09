import type { CanonicalId, CanonicalItem } from '../api/metadata/types.ts'
import type { TasteProfile } from './taste-profile.ts'
import { mapConcurrent } from './concurrency.ts'

export interface ScoredRecommendation extends CanonicalItem {
    score: number
    source: string
    reason?: string
    reasons?: string[]
    seedItemIds?: string[]
}

export interface SeedItem {
    itemId: string
    title: string
    type: string
    genres?: string[]
    progress: number
    timestamp: number
    season?: number
    episode?: number
}

export interface RankedRail {
    title: string
    items: ScoredRecommendation[]
    source: 'recommendations' | 'similar' | 'trending' | 'cf' | 'similar-accounts'
}

export interface RecommendationAdapter {
    getRecommendations?(seed: CanonicalItem, signal?: AbortSignal): AsyncIterable<CanonicalItem>
    getSimilar?(seed: CanonicalItem, signal?: AbortSignal): AsyncIterable<CanonicalItem>
}

export interface AdapterRoute {
    adapter: RecommendationAdapter
    match: (seed: CanonicalItem) => boolean
}

export function createMultiProviderAdapter(
    routes: AdapterRoute[],
    fallback: RecommendationAdapter
): RecommendationAdapter {
    return {
        async *getRecommendations(seed, signal) {
            let matched = false
            for (const route of routes) {
                if (route.match(seed) && route.adapter.getRecommendations) {
                    matched = true
                    yield* route.adapter.getRecommendations.call(route.adapter, seed, signal)
                }
            }
            if (!matched && fallback.getRecommendations) {
                yield* fallback.getRecommendations.call(fallback, seed, signal)
            }
        },
        async *getSimilar(seed, signal) {
            for (const route of routes) {
                if (route.match(seed) && route.adapter.getSimilar) {
                    yield* route.adapter.getSimilar.call(route.adapter, seed, signal)
                    return
                }
            }
            if (fallback.getSimilar) {
                yield* fallback.getSimilar.call(fallback, seed, signal)
            }
        },
    }
}

export interface DiscoveryFilters {
    obscurity?: 'popular' | 'balanced' | 'hidden' | 'gems' | 'obscure' | 'all'
    minRating?: number
    eraRange?: { from: number; to: number }
    typeMix?: 'movies' | 'series' | 'both'
    genreBoosts?: Record<string, number>
    excludedGenres?: string[]
    dismissedItems?: string[]
    lovedItems?: string[]
}

export interface BuildRecommendationsOptions {
    maxSeeds?: number
    railSize?: number
    signal?: AbortSignal
    meanRating?: number
    filters?: DiscoveryFilters
    tasteProfile?: TasteProfile
    watchedTmdbIds?: Set<string>
}

export interface BuildRecommendationsResult {
    rails: RankedRail[]
    totalCandidates: number
    failedSeedCount?: number
    firstError?: string | null
}

interface AggregatedSeed {
    itemId: string
    title: string
    type: string
    genres?: string[]
    timestamp: number
    episodeCount: number
    avgProgress: number
}

interface SeedWeight {
    engagement: number
    recency: number
    sourceWeight: number
}

interface CandidateAccumulator {
    item: CanonicalItem
    contributions: Array<{ seedItemId: string; weight: number }>
}

interface ScoredCandidate {
    item: CanonicalItem
    score: number
    contributions: Array<{ seedItemId: string; weight: number }>
}

const DAY_MS = 24 * 60 * 60 * 1000
const RECENCY_HALF_LIFE_DAYS = 180
const TRUST_THRESHOLD_M = 500
const DEFAULT_MAX_SEEDS = 15
const DEFAULT_RAIL_SIZE = 20
const MMR_LAMBDA = 0.7
const MIN_VOTE_COUNT = 20
const FILTER_PROGRESS_THRESHOLD = 30
const PER_SEED_RAIL_COUNT = 4
const FALLBACK_MEAN_RATING = 7.0

const BAD_NAME_RE = /^(tt\d{7,}|kitsu:\d+|mv:\d+|show:\d+|tmdb:\d+|mal:\d+|anilist:\d+|anidb:\d+|tvdb:\d+)$/i

export function isBadName(name: string): boolean {
    return !name || name === 'Unknown Title' || BAD_NAME_RE.test(name)
}

function clamp(v: number, min: number, max: number): number {
    if (v < min) return min
    if (v > max) return max
    return v
}

function hashStr(s: string): number {
    let h = 2166136261
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i)
        h = Math.imul(h, 16777619)
    }
    return h >>> 0
}

function isSeriesType(type: string): boolean {
    return type === 'series' || type === 'anime' || type === 'episode'
}

function candidateKey(id: CanonicalId): string {
    if (typeof id.tmdb === 'number' && id.tmdb > 0) return `tmdb:${id.tmdb}`
    if (id.imdb) return `imdb:${id.imdb}`
    return `slug:${id.slug}`
}

function matchesWatched(id: CanonicalId, watchedSet: ReadonlySet<string>): boolean {
    if (watchedSet.has(candidateKey(id))) return true
    if (id.imdb && watchedSet.has(id.imdb)) return true
    if (typeof id.tmdb === 'number') {
        if (watchedSet.has(`tmdb:${id.tmdb}`)) return true
        if (watchedSet.has(String(id.tmdb))) return true
    }
    if (watchedSet.has(id.slug)) return true
    return false
}

function parseSeedId(itemId: string): CanonicalId {
    const imdbMatch = itemId.match(/^(tt\d{7,})$/)
    if (imdbMatch) return { imdb: imdbMatch[1], slug: itemId }
    const tmdbMatch = itemId.match(/^tmdb:(\d+)$/i)
    if (tmdbMatch) {
        const n = Number(tmdbMatch[1])
        if (Number.isFinite(n)) return { tmdb: n, slug: itemId }
    }
    return { slug: itemId }
}

function aggregateSeeds(seeds: SeedItem[]): AggregatedSeed[] {
    const groups = new Map<string, SeedItem[]>()
    for (const s of seeds) {
        const arr = groups.get(s.itemId)
        if (arr) arr.push(s)
        else groups.set(s.itemId, [s])
    }
    const result: AggregatedSeed[] = []
    for (const [itemId, group] of groups) {
        let latest = group[0]
        for (const g of group) if (g.timestamp > latest.timestamp) latest = g
        const namedSeed = group.find(g => !isBadName(g.title))
        const episodeKeys = new Set<string>()
        for (const g of group) episodeKeys.add(`${g.season ?? 1}:${g.episode ?? 0}`)
        const episodeCount = isSeriesType(latest.type) ? episodeKeys.size : group.length
        const totalProgress = group.reduce((sum, x) => sum + x.progress, 0)
        const avgProgress = totalProgress / group.length
        const aggregated: AggregatedSeed = {
            itemId,
            title: namedSeed?.title ?? latest.title,
            type: latest.type,
            timestamp: latest.timestamp,
            episodeCount,
            avgProgress,
        }
        if (latest.genres && latest.genres.length > 0) aggregated.genres = latest.genres
        result.push(aggregated)
    }
    return result
}

function computeEngagement(seed: AggregatedSeed): number {
    const progressFactor = clamp(seed.avgProgress / 30, 0.1, 1.0)
    if (isSeriesType(seed.type)) {
        return Math.min(1.0, seed.episodeCount / 5) * progressFactor
    }
    return progressFactor
}

function computeRecency(timestamp: number, now: number): number {
    const daysSince = Math.max(0, (now - timestamp) / DAY_MS)
    return Math.exp(-daysSince / RECENCY_HALF_LIFE_DAYS)
}

function computeSeedWeights(seeds: AggregatedSeed[], now: number): Map<string, SeedWeight> {
    const result = new Map<string, SeedWeight>()
    for (const seed of seeds) {
        const engagement = computeEngagement(seed)
        const recency = computeRecency(seed.timestamp, now)
        result.set(seed.itemId, {
            engagement,
            recency,
            sourceWeight: engagement * recency,
        })
    }
    return result
}

function bayesianWeightedRating(
    voteCount: number | undefined,
    voteAverage: number | undefined,
    meanRating: number
): number {
    const v = typeof voteCount === 'number' && voteCount > 0 ? voteCount : 0
    const R = typeof voteAverage === 'number' && voteAverage > 0 ? voteAverage : 0
    const m = TRUST_THRESHOLD_M
    return (v / (v + m)) * R + (m / (v + m)) * meanRating
}

function genreJaccardSets(setA: Set<string>, setB: Set<string>): number {
    if (setA.size === 0 || setB.size === 0) return 0
    let intersection = 0
    for (const g of setA) {
        if (setB.has(g)) intersection += 1
    }
    const union = setA.size + setB.size - intersection
    return union > 0 ? intersection / union : 0
}

function seedToCanonical(seed: AggregatedSeed): CanonicalItem {
    const item: CanonicalItem = {
        id: parseSeedId(seed.itemId),
        title: seed.title,
        type: isSeriesType(seed.type) ? 'series' : (seed.type === 'movie' ? 'movie' : 'other'),
    }
    if (seed.genres && seed.genres.length > 0) item.genres = seed.genres
    return item
}

function profileMatchScore(item: CanonicalItem, profile: TasteProfile | undefined): number {
    if (!profile || profile.totalItems < 5) return 1

    const genreEntries = Object.values(profile.genres)
    const maxGenreWeight = genreEntries.length > 0
        ? Math.max(...genreEntries.map(g => g.weight), 0.001)
        : 0.001

    let genreMatch = 0
    if (item.genres) {
        for (const g of item.genres.slice(0, 3)) {
            const data = profile.genres[g]
            if (data) genreMatch = Math.max(genreMatch, data.weight / maxGenreWeight)
        }
    }

    let eraMatch = 0
    if (typeof item.year === 'number') {
        const decade = `${Math.floor(item.year / 10) * 10}s`
        eraMatch = profile.eras[decade] ?? 0
    }

    let base = Math.max(0.1, Math.min(genreMatch * 0.7 + eraMatch * 0.3, 1.0))

    const enriched = item as CanonicalItem & {
        cast?: Array<{ name?: string; id?: number }>
        crew?: Array<{ name?: string; id?: number; job?: string }>
    }
    if (profile.topCast && profile.topCast.length > 0 && Array.isArray(enriched.cast) && enriched.cast.length > 0) {
        const ids = new Set<string>()
        const names = new Set<string>()
        for (const c of profile.topCast) {
            if (c.id !== undefined) ids.add(String(c.id))
            if (c.name) names.add(c.name.toLowerCase())
        }
        let overlap = 0
        for (const c of enriched.cast!.slice(0, 5)) {
            if (!c) continue
            if (c.id !== undefined && ids.has(String(c.id))) { overlap++; continue }
            if (c.name && names.has(c.name.toLowerCase())) overlap++
        }
        if (overlap > 0) base = Math.min(1.0, base + 0.05 * overlap)
    }
    if (profile.topDirectors && profile.topDirectors.length > 0 && Array.isArray(enriched.crew) && enriched.crew.length > 0) {
        const ids = new Set<string>()
        const names = new Set<string>()
        for (const d of profile.topDirectors) {
            if (d.id !== undefined) ids.add(String(d.id))
            if (d.name) names.add(d.name.toLowerCase())
        }
        let overlap = 0
        for (const c of enriched.crew!.slice(0, 8)) {
            if (!c || c.job !== 'Director') continue
            if (c.id !== undefined && ids.has(String(c.id))) { overlap++; continue }
            if (c.name && names.has(c.name.toLowerCase())) overlap++
        }
        if (overlap > 0) base = Math.min(1.0, base + 0.07 * overlap)
    }

    return base
}

function scoreAccumulator(acc: CandidateAccumulator, meanRating: number, genreBoosts?: Record<string, number>, lovedSet?: ReadonlySet<string>, profile?: TasteProfile): number {
    const sumWeights = acc.contributions.reduce((s, x) => s + x.weight, 0)
    const appearance = Math.log(1 + sumWeights)
    const wr = bayesianWeightedRating(acc.item.voteCount, acc.item.voteAverage, meanRating)
    let score = appearance * (wr / 10)

    const pms = profileMatchScore(acc.item, profile)
    score *= pms

    const voteCount = acc.item.voteCount ?? 0
    const obscurityBoost = voteCount < 500
        ? 1 + Math.min(0.5, (500 - voteCount) / 1000)
        : 1
    score *= obscurityBoost

    if (genreBoosts && acc.item.genres && acc.item.genres.length > 0) {
        let boostMultiplier = 1
        for (const g of acc.item.genres.slice(0, 3)) {
            const boost = genreBoosts[g]
            if (typeof boost === 'number' && boost > 0) boostMultiplier *= boost
        }
        score *= Math.min(boostMultiplier, 3.0)
    }
    if (lovedSet && matchesWatched(acc.item.id, lovedSet)) {
        score *= 1.5
    }
    const dayKey = Math.floor(Date.now() / 86400000)
    score += (hashStr(candidateKey(acc.item.id) + dayKey) % 100) / 5000
    return score
}

function mmrRerank(
    items: ScoredCandidate[],
    lambda: number,
    maxSize: number
): ScoredCandidate[] {
    if (items.length === 0) return []
    const genreSets = new Map(items.map(s => [s, new Set((s.item.genres ?? []).map(g => g.toLowerCase()))]))
    const remaining = items.slice()
    const selected: ScoredCandidate[] = []
    const selectedSets: Set<string>[] = []
    while (selected.length < maxSize && remaining.length > 0) {
        let bestIdx = 0
        let bestScore = -Infinity
        for (let i = 0; i < remaining.length; i++) {
            const relevance = lambda * remaining[i].score
            let maxSim = 0
            const itemSet = genreSets.get(remaining[i])!
            for (const sSet of selectedSets) {
                const sim = genreJaccardSets(itemSet, sSet)
                if (sim > maxSim) maxSim = sim
            }
            const mmrScore = relevance - (1 - lambda) * maxSim
            if (mmrScore > bestScore) {
                bestScore = mmrScore
                bestIdx = i
            }
        }
        selected.push(remaining[bestIdx])
        selectedSets.push(genreSets.get(remaining[bestIdx])!)
        remaining[bestIdx] = remaining[remaining.length - 1]
        remaining.pop()
    }
    return selected
}

function toScoredRecommendation(
    scored: ScoredCandidate,
    source: string,
    reason: string | undefined
): ScoredRecommendation {
    const result: ScoredRecommendation = {
        ...scored.item,
        score: scored.score,
        source,
        seedItemIds: scored.contributions.map(c => c.seedItemId),
    }
    if (reason) result.reason = reason

    const reasons: string[] = []
    if (scored.contributions.length >= 2) {
        reasons.push(`Recommended by ${scored.contributions.length} sources`)
    }
    if (typeof scored.item.voteAverage === 'number' && scored.item.voteAverage >= 7.5) {
        reasons.push(`Highly rated (${scored.item.voteAverage.toFixed(1)})`)
    }
    if (scored.item.genres && scored.item.genres.length > 0) {
        reasons.push(scored.item.genres.slice(0, 3).join(' / '))
    }
    if ((scored.item.voteCount ?? 0) > 0 && (scored.item.voteCount ?? 0) < 500) {
        reasons.push('Hidden gem')
    }
    if (reasons.length > 0) result.reasons = reasons

    return result
}

function passesHardFilter(item: CanonicalItem, watchedSet: ReadonlySet<string>, filters?: DiscoveryFilters, dismissedSet?: ReadonlySet<string>): boolean {
    if (matchesWatched(item.id, watchedSet)) return false
    if ((item.voteCount ?? 0) < MIN_VOTE_COUNT) return false
    if (!item.poster) return false
    if (filters) {
        if (dismissedSet) {
            if (matchesWatched(item.id, dismissedSet)) return false
        }
        if (typeof filters.minRating === 'number' && filters.minRating > 0) {
            if ((item.voteAverage ?? 0) < filters.minRating) return false
        }
        if (filters.eraRange) {
            if (typeof item.year === 'number') {
                if (item.year < filters.eraRange.from || item.year > filters.eraRange.to) return false
            }
        }
        if (filters.excludedGenres && filters.excludedGenres.length > 0 && item.genres) {
            const hasExcludedGenre = item.genres.some(g => filters.excludedGenres!.includes(g))
            if (hasExcludedGenre) return false
        }
        if (filters.typeMix && filters.typeMix !== 'both') {
            if (filters.typeMix === 'movies' && item.type !== 'movie') return false
            if (filters.typeMix === 'series' && item.type !== 'series' && item.type !== 'anime') return false
        }
        if (filters.obscurity === 'popular' && (item.voteCount ?? 0) < 500) return false
        if (filters.obscurity === 'balanced' && (item.voteCount ?? 0) > 10000) return false
        if (filters.obscurity === 'hidden' && (item.voteCount ?? 0) > 2000) return false
        if (filters.obscurity === 'gems' && (item.voteCount ?? 0) > 1000) return false
        if (filters.obscurity === 'obscure' && (item.voteCount ?? 0) > 500) return false
    }
    return true
}

function applyGenreCap(items: ScoredCandidate[], maxRatio: number): ScoredCandidate[] {
    const maxPerGenre = Math.ceil(items.length * maxRatio)
    const genreCounts: Record<string, number> = {}
    const result: ScoredCandidate[] = []
    for (const item of items) {
        const primaryGenre = item.item.genres?.[0]
        if (!primaryGenre || (genreCounts[primaryGenre] || 0) < maxPerGenre) {
            if (primaryGenre) genreCounts[primaryGenre] = (genreCounts[primaryGenre] || 0) + 1
            result.push(item)
        }
    }
    return result
}

export async function buildRecommendations(
    seeds: SeedItem[],
    adapter: RecommendationAdapter,
    options?: BuildRecommendationsOptions
): Promise<BuildRecommendationsResult> {
    if (!seeds || seeds.length < 5) return { rails: [], totalCandidates: 0 }
    const getRecs = adapter.getRecommendations
    if (!getRecs) return { rails: [], totalCandidates: 0 }

    const maxSeeds = options?.maxSeeds ?? DEFAULT_MAX_SEEDS
    const railSize = options?.railSize ?? DEFAULT_RAIL_SIZE
    const signal = options?.signal
    const meanRating = options?.meanRating ?? FALLBACK_MEAN_RATING
    const filters = options?.filters
    const tasteProfile = options?.tasteProfile
    const dismissedSet = new Set<string>(filters?.dismissedItems ?? [])
    const lovedSet = new Set<string>(filters?.lovedItems ?? [])
    const genreBoosts = filters?.genreBoosts

    const now = Date.now()
    const aggregated = aggregateSeeds(seeds)
    const weights = computeSeedWeights(aggregated, now)

    const sortedSeeds = aggregated
        .slice()
        .sort((a, b) => (weights.get(b.itemId)?.sourceWeight ?? 0) - (weights.get(a.itemId)?.sourceWeight ?? 0))
    const topSeeds = sortedSeeds.slice(0, maxSeeds)

    const watchedSet = new Set<string>()
    for (const s of aggregated) {
        if (s.avgProgress > FILTER_PROGRESS_THRESHOLD) {
            watchedSet.add(s.itemId)
            const canonical = parseSeedId(s.itemId)
            watchedSet.add(candidateKey(canonical))
            if (canonical.imdb) watchedSet.add(canonical.imdb)
            if (typeof canonical.tmdb === 'number') {
                watchedSet.add(`tmdb:${canonical.tmdb}`)
                watchedSet.add(String(canonical.tmdb))
            }
            if (canonical.slug) watchedSet.add(canonical.slug)
        }
    }
    if (options?.watchedTmdbIds) {
        for (const id of options.watchedTmdbIds) watchedSet.add(id)
    }

    const candidateMap = new Map<string, CandidateAccumulator>()
    const perSeedCandidates = new Map<string, CanonicalItem[]>()
    let failedSeedCount = 0
    let firstError: string | null = null

    await mapConcurrent(topSeeds, 6, async (seed) => {
        if (signal?.aborted) return
        const seedCanonical = seedToCanonical(seed)
        const weight = weights.get(seed.itemId)?.sourceWeight ?? 0
        const collected: CanonicalItem[] = []
        try {
            const gen = getRecs.call(adapter, seedCanonical, signal)
            for await (const cand of gen) {
                if (signal?.aborted) break
                collected.push(cand)
                const key = candidateKey(cand.id)
                const existing = candidateMap.get(key)
                if (existing) {
                    existing.contributions.push({ seedItemId: seed.itemId, weight })
                } else {
                    candidateMap.set(key, {
                        item: cand,
                        contributions: [{ seedItemId: seed.itemId, weight }],
                    })
                }
            }
            if (collected.length === 0 && !signal?.aborted) failedSeedCount++
        } catch (err) {
            if (!signal?.aborted) {
                failedSeedCount++
                if (!firstError) firstError = err instanceof Error ? err.message : String(err)
            }
        }
        perSeedCandidates.set(seed.itemId, collected)
    })

    const filtered: CandidateAccumulator[] = []
    for (const c of candidateMap.values()) {
        if (passesHardFilter(c.item, watchedSet, filters, dismissedSet)) filtered.push(c)
    }

    const scoredAll: ScoredCandidate[] = filtered.map(c => ({
        item: c.item,
        score: scoreAccumulator(c, meanRating, genreBoosts, lovedSet, tasteProfile),
        contributions: c.contributions,
    }))

    const movies = scoredAll.filter(s => s.item.type === 'movie')
    const series = scoredAll.filter(s => s.item.type === 'series' || s.item.type === 'anime')
    const mmrMovies = applyGenreCap(mmrRerank(movies, MMR_LAMBDA, railSize), 0.5)
    const mmrSeries = applyGenreCap(mmrRerank(series, MMR_LAMBDA, railSize), 0.5)

    const rails: RankedRail[] = []

    if (mmrMovies.length > 0) {
        rails.push({
            title: 'Recommended Movies',
            source: 'recommendations',
            items: mmrMovies.map(s => toScoredRecommendation(s, 'tmdb', undefined)),
        })
    }
    if (mmrSeries.length > 0) {
        rails.push({
            title: 'Recommended Series',
            source: 'recommendations',
            items: mmrSeries.map(s => toScoredRecommendation(s, 'tmdb', undefined)),
        })
    }

    const topSeedRailCount = Math.min(PER_SEED_RAIL_COUNT, topSeeds.length)
    for (let i = 0; i < topSeedRailCount; i++) {
        const seed = topSeeds[i]
        const seedCands = perSeedCandidates.get(seed.itemId) ?? []
        const weight = weights.get(seed.itemId)?.sourceWeight ?? 0
        const seedScored: ScoredCandidate[] = []
        for (const cand of seedCands) {
            if (!passesHardFilter(cand, watchedSet, filters, dismissedSet)) continue
            const wr = bayesianWeightedRating(cand.voteCount, cand.voteAverage, meanRating)
            const appearance = Math.log(1 + weight)
            const base = appearance * (wr / 10)
            seedScored.push({
                item: cand,
                score: base,
                contributions: [{ seedItemId: seed.itemId, weight }],
            })
        }
        const reranked = mmrRerank(seedScored, MMR_LAMBDA, railSize)
        if (reranked.length === 0) continue
        const seedTitle = isBadName(seed.title) ? 'this' : seed.title
        const reason = `Because you watched ${seedTitle}`
        rails.push({
            title: reason,
            source: 'recommendations',
            items: reranked.map(s => toScoredRecommendation(s, 'tmdb', reason)),
        })
    }

    return { rails, totalCandidates: candidateMap.size, failedSeedCount, firstError }
}

export async function buildColdStartRails(
    signal?: AbortSignal,
    railSize = 20,
    watchedTmdbIds?: Set<string>
): Promise<RankedRail[]> {
    const { fetchTrendingBatch } = await import('../api/metadata/adapters/tmdb.ts')
    const fetchSize = watchedTmdbIds ? railSize * 2 : railSize
    const [movies, series] = await Promise.all([
        fetchTrendingBatch('movie', signal, fetchSize),
        fetchTrendingBatch('tv', signal, fetchSize),
    ])

    const filterWatched = (items: typeof movies) => watchedTmdbIds
        ? items.filter(item => !(typeof item.id.tmdb === 'number' && watchedTmdbIds.has(`tmdb:${item.id.tmdb}`)))
        : items

    const fMovies = filterWatched(movies).slice(0, railSize)
    const fSeries = filterWatched(series).slice(0, railSize)

    if (fMovies.length > 0 || fSeries.length > 0) {
        const rails: RankedRail[] = []
        if (fMovies.length > 0) {
            rails.push({
                title: 'Trending Movies',
                source: 'trending',
                items: fMovies.map(item => ({ ...item, score: item.voteAverage ?? 0, source: 'trending' })),
            })
        }
        if (fSeries.length > 0) {
            rails.push({
                title: 'Trending Series',
                source: 'trending',
                items: fSeries.map(item => ({ ...item, score: item.voteAverage ?? 0, source: 'trending' })),
            })
        }
        return rails
    }

    return buildCinemetaColdStartRails(signal, railSize)
}

async function buildCinemetaColdStartRails(
    signal?: AbortSignal,
    railSize = 20
): Promise<RankedRail[]> {
    const CINEMETA = 'https://v3-cinemeta.strem.io'

    async function fetchCatalog(type: 'movie' | 'series'): Promise<ScoredRecommendation[]> {
        try {
            const res = await fetch(`${CINEMETA}/catalog/${type}/top.json`, { signal })
            if (!res.ok) return []
            const data = await res.json()
            const metas = Array.isArray(data?.metas) ? data.metas : []
            return metas.slice(0, railSize).map((m: Record<string, unknown>) => {
                const imdbId = String(m.id ?? '')
                const yearStr = typeof m.year === 'string' ? m.year : undefined
                const rating = typeof m.imdbRating === 'string' ? parseFloat(m.imdbRating) : undefined
                return {
                    id: { imdb: imdbId, slug: imdbId },
                    title: String(m.name ?? 'Unknown'),
                    type: type === 'series' ? 'series' as const : 'movie' as const,
                    poster: typeof m.poster === 'string' ? m.poster : undefined,
                    backdrop: typeof m.background === 'string' ? m.background : undefined,
                    year: yearStr ? parseInt(yearStr, 10) : undefined,
                    voteAverage: rating,
                    voteCount: 0,
                    score: rating ?? 0,
                    source: 'cinemeta',
                }
            })
        } catch {
            return []
        }
    }

    const [movies, series] = await Promise.all([
        fetchCatalog('movie'),
        fetchCatalog('series'),
    ])

    const rails: RankedRail[] = []
    if (movies.length > 0) {
        rails.push({ title: 'Popular Movies', source: 'trending', items: movies })
    }
    if (series.length > 0) {
        rails.push({ title: 'Popular Series', source: 'trending', items: series })
    }
    return rails
}
