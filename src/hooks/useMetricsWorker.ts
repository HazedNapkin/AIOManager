import { useState, useEffect, useRef } from 'react'
import { ActivityItem } from '@/types/activity'

interface UserStatsEntry {
    id: string
    name: string
    currentStreak: number
    bestStreak: number
    count: number
    duration: number
    recentHistory: ActivityItem[]
    bingeDuration: number
    bingeItems: ActivityItem[]
    avatarChar: string
    rank?: number
}

interface AwardEntry {
    id: string
    name: string
    count: number
}

interface CompletionEntry {
    id: string
    name: string
    rate: number
    finishes: number
}

interface SharedUniverseEntry {
    item: ActivityItem
    count: number
    accounts: { id: string; name: string; count: number; firstWatched: Date }[]
    firstSeen: Date
    lastSeen: Date
}

interface VelocityEntry {
    item: ActivityItem
    days: number
    episodes: number
    velocity: number
}

interface PersonaBadge {
    type: string
    icon: string
    color: string
}

interface PersonaEntry {
    id: string
    name: string
    badges: PersonaBadge[]
}

interface TraitMeta {
    label: string
    icon: string
    color: string
}

interface TraitEntry {
    id: string
    name: string
    chronotype: TraitMeta
    formatLoyalty: TraitMeta
}

interface FranchiseEntry {
    name: string
    count: number
}

interface TopAllTimeEntry {
    count: number
    item: ActivityItem
    shared: boolean
}

export interface MetricsResult {
    totalItems: number
    totalHours: number
    leaderboard: UserStatsEntry[]
    bingeMasters: UserStatsEntry[]
    streakMasters: UserStatsEntry[]
    topTrending: ActivityItem[]
    topAllTime: TopAllTimeEntry[]
    funnel: { started: number; engaged: number; finished: number }
    abandonedSeries: ActivityItem[]
    abandonedMovies: ActivityItem[]
    awards: { midnightSnackers: AwardEntry[]; weekendWarriors: AwardEntry[]; completionChampions: CompletionEntry[] }
    itemsByHour: number[]
    sharedUniverse: SharedUniverseEntry[]
    contentVelocity: VelocityEntry[]
    typeCounts: { movie: number; series: number; other: number }
    seriesLoyalty: number
    userPersonas: PersonaEntry[]
    userTraits: TraitEntry[]
    franchiseFocus: FranchiseEntry[]
    rareFinds: ActivityItem[]
    streakMap: number[]
    topPilot: UserStatsEntry | null
    theLoop: TopAllTimeEntry | null
    maxActivityHour: number
    weekOverWeek: number
    thisWeekCount: number
    lastWeekCount: number
    firstWatch: { item: ActivityItem; date: Date } | null
    dailyActivity: Record<string, number>
    sessionDepths: { label: string; count: number }[]
    weeklyRhythm: number[]
    comebackTitles: { name: string; gap: number; poster: string }[]
    dropOffAvg: number
    _error?: boolean
    _message?: string
}

const METRICS_WORKER_TIMEOUT_MS = 30000

function createEmptyMetricsResult(): MetricsResult {
    return {
        totalItems: 0,
        totalHours: 0,
        leaderboard: [],
        bingeMasters: [],
        streakMasters: [],
        topTrending: [],
        topAllTime: [],
        funnel: { started: 0, engaged: 0, finished: 0 },
        abandonedSeries: [],
        abandonedMovies: [],
        awards: { midnightSnackers: [], weekendWarriors: [], completionChampions: [] },
        itemsByHour: new Array(24).fill(0),
        sharedUniverse: [],
        contentVelocity: [],
        typeCounts: { movie: 0, series: 0, other: 0 },
        seriesLoyalty: 0,
        userPersonas: [],
        userTraits: [],
        franchiseFocus: [],
        rareFinds: [],
        streakMap: new Array(30).fill(0),
        topPilot: null,
        theLoop: null,
        maxActivityHour: 0,
        weekOverWeek: 0,
        thisWeekCount: 0,
        lastWeekCount: 0,
        firstWatch: null,
        dailyActivity: {},
        sessionDepths: [],
        weeklyRhythm: new Array(7).fill(0),
        comebackTitles: [],
        dropOffAvg: 0,
    }
}

function createMetricsWorker(): Worker {
    if (import.meta.env.DEV) console.log('[useMetricsWorker] Initializing worker...')
    return new Worker(
        new URL('../workers/metricsWorker.ts', import.meta.url)
    )
}

function getTimestampMs(value: ActivityItem['timestamp']): number {
    const time = value instanceof Date ? value.getTime() : new Date(value).getTime()
    return Number.isFinite(time) ? time : 0
}

function createItemsFingerprint(items: ActivityItem[]): string {
    let hash = 2166136261

    const mix = (value: unknown) => {
        const text = String(value ?? '')
        for (let i = 0; i < text.length; i++) {
            hash ^= text.charCodeAt(i)
            hash = Math.imul(hash, 16777619)
        }
        hash ^= 31
        hash = Math.imul(hash, 16777619)
    }

    mix(items.length)

    for (const item of items) {
        mix(item.id)
        mix(item.accountId)
        mix(item.accountName)
        mix(item.itemId)
        mix(item.uniqueItemId)
        mix(item.name)
        mix(item.type)
        mix(getTimestampMs(item.timestamp))
        mix(item.duration)
        mix(item.watched)
        mix(item.progress)
        mix(item.timesWatched)
        mix(item.isInProgress)
        mix(item.season)
        mix(item.episode)
        mix(item.overallTimeWatched)
    }

    return `${items.length}-${hash >>> 0}`
}

export function useMetricsWorker(items: ActivityItem[]) {
    const [results, setResults] = useState<MetricsResult | null>(null)
    const [isComputing, setIsComputing] = useState(false)
    const workerRef = useRef<Worker | null>(null)
    const lastFingerprintRef = useRef<string>('')

    useEffect(() => {
        if (!workerRef.current) {
            workerRef.current = createMetricsWorker()

            workerRef.current.onmessage = (e) => {
                setResults(e.data)
                setIsComputing(false)
            }

            workerRef.current.onerror = (e) => {
                if (import.meta.env.DEV) console.error('[useMetricsWorker] Worker error:', e)
                setIsComputing(false)
                setResults({ _error: true, _message: 'Metrics worker crashed.' } as MetricsResult)
            }
        }

        return () => {
            if (workerRef.current) {
                if (import.meta.env.DEV) console.log('[useMetricsWorker] Terminating worker...')
                workerRef.current.terminate()
                workerRef.current = null
                lastFingerprintRef.current = ''
            }
        }
    }, [])

    useEffect(() => {
        if (items.length === 0) {
            setResults(createEmptyMetricsResult())
            setIsComputing(false)
            lastFingerprintRef.current = ''
            return
        }

        if (!workerRef.current) {
            workerRef.current = createMetricsWorker()
        }

        const worker = workerRef.current
        const fingerprint = createItemsFingerprint(items)

        if (fingerprint === lastFingerprintRef.current) {
            return
        }

        lastFingerprintRef.current = fingerprint
        setIsComputing(true)

        const timeoutId = setTimeout(() => {
            if (workerRef.current === worker) {
                if (import.meta.env.DEV) console.error('[useMetricsWorker] Worker timeout - terminating and restarting')
                worker.terminate()
                workerRef.current = null
                lastFingerprintRef.current = ''
                setIsComputing(false)
                setResults({ _error: true, _message: `Metrics calculation timed out after ${METRICS_WORKER_TIMEOUT_MS / 1000}s.` } as MetricsResult)
            }
        }, METRICS_WORKER_TIMEOUT_MS)

        worker.onmessage = (e) => {
            clearTimeout(timeoutId)
            setResults(e.data)
            setIsComputing(false)
        }

        worker.onerror = (e) => {
            clearTimeout(timeoutId)
            if (import.meta.env.DEV) console.error('[useMetricsWorker] Worker error:', e)
            setIsComputing(false)
            setResults({ _error: true, _message: 'Metrics worker crashed.' } as MetricsResult)
        }

        worker.postMessage({ items })

        return () => clearTimeout(timeoutId)
    }, [items])

    return { results, isComputing }
}
