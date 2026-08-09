import { useEffect, useState, useRef, useMemo, memo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import localforage from 'localforage'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { toast } from '@/hooks/use-toast'
import { useTheme } from '@/contexts/ThemeContext'

import { Skeleton } from '@/components/ui/skeleton'
import { Poster } from '@/components/common/Poster'
import { fetchCinemetaDetail, type CinemetaMeta, type CinemetaCastMember, type CinemetaReview } from '@/lib/activity-utils'
import { resolveTrailerAsync, type TrailerResult } from '@/lib/trailer-resolver'
import { fetchTmdbDetailsAsMeta, fetchTmdbImdbId, proxyFetch, searchTmdbPerson, fetchSeasonEpisodes, fetchSeasonsList, type SeasonInfo, type EpisodeInfo } from '@/api/metadata/adapters/tmdb'
import { traceAsync } from '@/api/metadata/adapters/shared-fetch'
import { addToWatchlist, removeFromWatchlist, getWatchlist } from '@/lib/watchlist'
import { getPmdbRating } from '@/api/metadata/adapters/pmdb'
import { cn, openStremioDetail } from '@/lib/utils'
import { Tooltip } from '@/components/ui/tooltip'
import { useAccountStore } from '@/store/accountStore'
import { useUIStore } from '@/store/uiStore'
import { AccountAvatar } from '@/components/accounts/AccountAvatar'
import { AccountAvatar as AccountSwitcherAvatar, maskedDisplayName } from '@/components/common/AccountSwitcher'
import { useWatchHistory } from '@/hooks/useWatchHistory'
import { Star, Clock, Calendar, Play, ExternalLink, ChevronDown, ChevronUp, Film, Clapperboard, ArrowLeft, User, ChevronLeft, ChevronRight, MessageSquare, Tv, Sparkles, Languages, Building2, Plus, Check, Layers, X, Users, ZoomIn, Search } from 'lucide-react'
import type { Account } from '@/types/account'
import type { RailWatcher } from '@/components/ui/content-rail'

// ── Types ─────────────────────────────────────────────────────────────────

export type RatingSource =
    | 'imdb'
    | 'tomatoes'
    | 'popcorn'
    | 'metacritic'
    | 'trakt'
    | 'letterboxd'
    | 'pmdb'
    | 'tmdb'
    | 'simkl'

interface ProviderRating {
    source: RatingSource
    value: string
    votes?: string
}

export interface DetailItem {
    itemId: string
    type: string
    name?: string
    poster?: string
    genres?: string[]
    firstWatched?: Date
    season?: number
    episode?: number
    year?: number
    voteAverage?: number
    description?: string
    backdrop?: string
    accountId?: string
}

interface ActivityDetailModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    item: DetailItem | null
}

// ── Constants ─────────────────────────────────────────────────────────────

const CAST_DISPLAY_LIMIT = 20
const DESCRIPTION_COLLAPSE_LENGTH = 240
const TMDB_PROFILE_BASE = 'https://image.tmdb.org/t/p/w185'

const RATING_LABELS: Record<string, string> = {
    tomatoes: 'Rotten Tomatoes Tomatometer',
    popcorn: 'Rotten Tomatoes Audience Score',
    metacritic: 'Metacritic Metascore',
    imdb: 'IMDb Rating',
    trakt: 'Trakt Rating',
    letterboxd: 'Letterboxd Rating',
    tmdb: 'TMDB Rating',
    pmdb: 'PublicMetaDB Rating',
}

// ── Rating Badge Component with Official Brand SVG Logos ─────────────────

const RatingBadge = memo(function RatingBadge({ rating }: { rating: ProviderRating }) {
    const { source, value } = rating

    if (source === 'tomatoes') {
        const numVal = parseInt(value, 10)
        const isFresh = isNaN(numVal) || numVal >= 60
        return (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/35 bg-black/70 px-2 py-1 text-xs font-bold backdrop-blur-md shadow-md">
                {isFresh ? (
                    <svg viewBox="0 0 32 32" className="h-4 w-4 shrink-0 drop-shadow">
                        <path d="M16 2C14.5 5 11.5 6 8.5 5.5C11 8.5 14 8.5 16 6.5C18 8.5 21 8.5 23.5 5.5C20.5 6 17.5 5 16 2Z" fill="#22C55E" />
                        <circle cx="16" cy="18" r="11" fill="#FA320A" />
                        <ellipse cx="13" cy="14" rx="2" ry="3" fill="#FF6B4A" opacity="0.6" />
                    </svg>
                ) : (
                    <svg viewBox="0 0 32 32" className="h-4 w-4 shrink-0 drop-shadow">
                        <path d="M16 6C12 7.5 8 5.5 5.5 11.5C3.5 17.5 7.5 24.5 14 26.5C20.5 28.5 26.5 24.5 26.5 18.5C26.5 12.5 22.5 10.5 16 6Z" fill="#68A040" />
                        <circle cx="10" cy="15" r="1.5" fill="#4B772D" />
                        <circle cx="20" cy="19" r="2" fill="#4B772D" />
                    </svg>
                )}
                <span className="tabular-nums font-black text-white">{value}</span>
            </span>
        )
    }

    if (source === 'popcorn') {
        return (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/35 bg-black/70 px-2 py-1 text-xs font-bold backdrop-blur-md shadow-md">
                <svg viewBox="0 0 32 32" className="h-4 w-4 shrink-0 drop-shadow">
                    <circle cx="12" cy="9" r="3.5" fill="#FFE58F" />
                    <circle cx="16" cy="7" r="4" fill="#FFF0B6" />
                    <circle cx="20" cy="9" r="3.5" fill="#FFE58F" />
                    <path d="M9 12L11 26H21L23 12H9Z" fill="#FA320A" />
                    <path d="M13 12L14 26H16L15 12H13Z" fill="#FFFFFF" />
                    <path d="M17 12L18 26H20L19 12H17Z" fill="#FFFFFF" />
                </svg>
                <span className="tabular-nums font-black text-white">{value}</span>
            </span>
        )
    }

    if (source === 'metacritic') {
        const score = parseInt(value, 10)
        const bg = isNaN(score) || score >= 60 ? 'bg-emerald-500' : score >= 40 ? 'bg-amber-500' : 'bg-red-500'
        return (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-black/70 px-2 py-1 text-xs font-bold backdrop-blur-md shadow-md">
                <span className={`flex h-4 w-4 items-center justify-center rounded-sm text-[10px] font-black text-black ${bg}`}>m</span>
                <span className="tabular-nums font-black text-white">{value}</span>
            </span>
        )
    }

    if (source === 'imdb') {
        return (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/40 bg-black/70 px-2 py-1 text-xs font-bold backdrop-blur-md shadow-md">
                <svg viewBox="0 0 64 32" className="h-4 w-9 shrink-0 rounded-sm">
                    <rect width="64" height="32" rx="4" fill="#F5C518" />
                    <text x="32" y="22" fill="#000000" fontSize="20" fontWeight="900" textAnchor="middle" fontFamily="Arial Black, Impact, sans-serif">IMDb</text>
                </svg>
                <span className="tabular-nums font-black text-white">{value}</span>
            </span>
        )
    }

    if (source === 'trakt') {
        return (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-red-600/40 bg-black/70 px-2 py-1 text-xs font-bold backdrop-blur-md shadow-md">
                <svg viewBox="0 0 32 32" className="h-4 w-4 shrink-0 rounded-sm">
                    <rect width="32" height="32" rx="6" fill="#ED1C24" />
                    <path d="M8 9H24V13H18V24H14V13H8V9Z" fill="#FFFFFF" />
                </svg>
                <span className="tabular-nums font-black text-white">{value}</span>
            </span>
        )
    }

    if (source === 'letterboxd') {
        return (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-black/70 px-2 py-1 text-xs font-bold backdrop-blur-md shadow-md">
                <svg viewBox="0 0 36 16" className="h-3.5 w-8 shrink-0">
                    <circle cx="8" cy="8" r="6" fill="#00E054" />
                    <circle cx="18" cy="8" r="6" fill="#40BCF4" />
                    <circle cx="28" cy="8" r="6" fill="#FF8000" />
                </svg>
                <span className="tabular-nums font-black text-white">{value}</span>
            </span>
        )
    }

    if (source === 'tmdb') {
        return (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-black/70 px-2 py-1 text-xs font-bold backdrop-blur-md shadow-md">
                <svg viewBox="0 0 40 20" className="h-3.5 w-7 shrink-0 rounded-sm">
                    <rect width="40" height="20" rx="3" fill="#0D253F" />
                    <text x="20" y="14" fill="#01B4E4" fontSize="11" fontWeight="900" textAnchor="middle" fontFamily="Arial Black, sans-serif">TMDB</text>
                </svg>
                <span className="tabular-nums font-black text-white">{value}</span>
            </span>
        )
    }

    if (source === 'pmdb') {
        return (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/40 bg-black/70 px-2 py-1 text-xs font-bold backdrop-blur-md shadow-md">
                <svg viewBox="0 0 40 20" className="h-3.5 w-8 shrink-0 rounded-sm">
                    <rect width="40" height="20" rx="3" fill="#7C3AED" />
                    <text x="20" y="14" fill="#FFFFFF" fontSize="10" fontWeight="900" textAnchor="middle" fontFamily="Arial Black, sans-serif">PMDB</text>
                </svg>
                <span className="tabular-nums font-black text-white">{value}</span>
            </span>
        )
    }

    if (source === 'simkl') {
        return (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-orange-500/40 bg-black/70 px-2 py-1 text-xs font-bold backdrop-blur-md shadow-md">
                <svg viewBox="0 0 40 20" className="h-3.5 w-8 shrink-0 rounded-sm">
                    <rect width="40" height="20" rx="3" fill="#F97316" />
                    <text x="20" y="14" fill="#FFFFFF" fontSize="9" fontWeight="900" textAnchor="middle" fontFamily="Arial Black, sans-serif">SIMKL</text>
                </svg>
                <span className="tabular-nums font-black text-white">{value}</span>
            </span>
        )
    }

    return (
        <Tooltip content={`${source} Rating`}>
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-blue-500/40 bg-black/70 px-2 py-1 text-xs font-bold backdrop-blur-md shadow-md">
                <Star className="h-3.5 w-3.5 fill-current text-blue-400" />
                <span className="tabular-nums font-black text-white">{value}</span>
            </span>
        </Tooltip>
    )
})

// ── Rating Fetchers ───────────────────────────────────────────────────────

async function authedFetch(url: string, options?: RequestInit): Promise<Response> {
    try {
        const { useSyncStore } = await import('@/store/syncStore')
        const { deriveSyncToken } = await import('@/lib/crypto')
        const auth = useSyncStore.getState().auth
        const headers: Record<string, string> = { ...(options?.headers as Record<string, string>) }
        if (auth.isAuthenticated) {
            headers['x-sync-user'] = auth.id
            headers['x-sync-password'] = await deriveSyncToken(auth.password)
        }
        return fetch(url, { ...options, headers })
    } catch {
        return fetch(url, options)
    }
}

async function getPmdbRatingFromImdb(
    imdbId: string,
    type: string,
): Promise<{ score: number | null; voteCount: number } | null> {
    try {
        const res = await authedFetch(
            `/api/metadata/tmdb/find/${encodeURIComponent(imdbId)}?external_source=imdb_id`,
        )
        if (!res.ok) return null
        const data = await res.json()
        const isTv = type === 'series' || type === 'anime'
        const tmdbId =
            (isTv
                ? (Array.isArray(data?.tv_results) && data.tv_results.length > 0
                    ? data.tv_results[0].id
                    : null)
                : null
            ) ??
            (Array.isArray(data?.movie_results) && data.movie_results.length > 0
                ? data.movie_results[0].id
                : null) ??
            (!isTv && Array.isArray(data?.tv_results) && data.tv_results.length > 0
                ? data.tv_results[0].id
                : null)
        if (!tmdbId) return null
        const mediaType = isTv ? 'tv' : 'movie'
        const pmdb = await getPmdbRating(tmdbId, undefined, mediaType)
        if (!pmdb) return null
        return { score: pmdb.rating, voteCount: pmdb.voteCount }
    } catch {
        return null
    }
}

async function fetchAdditionalRatings(imdbId: string): Promise<ProviderRating[]> {
    const results: ProviderRating[] = []
    const has = (src: RatingSource) => results.some(x => x.source === src)
    const DEV = import.meta.env?.DEV

    if (imdbId.startsWith('tt')) {
        try {
            const mdblistRes = await authedFetch(`/api/metadata/mdblist/i/${encodeURIComponent(imdbId)}`)
            if (DEV) console.log('[trace] mdblist: status=%d ok=%b', mdblistRes.status, mdblistRes.ok)
            if (mdblistRes.ok) {
                const data = await mdblistRes.json()
                const before = results.length
                if (Array.isArray(data?.ratings)) {
                    for (const r of data.ratings) {
                        if (r.source === 'tomatoes' && r.value && !has('tomatoes')) {
                            results.push({ source: 'tomatoes', value: `${r.value}%` })
                        } else if (r.source === 'tomatoesaudience' && r.value && !has('popcorn')) {
                            results.push({ source: 'popcorn', value: `${r.value}%` })
                        } else if (r.source === 'metacritic' && r.value && !has('metacritic')) {
                            results.push({ source: 'metacritic', value: String(r.value) })
                        } else if (r.source === 'trakt' && r.value && !has('trakt')) {
                            results.push({ source: 'trakt', value: typeof r.value === 'number' ? (r.value > 10 ? (r.value / 10).toFixed(1) : r.value.toFixed(1)) : String(r.value) })
                        } else if (r.source === 'letterboxd' && r.value && !has('letterboxd')) {
                            results.push({ source: 'letterboxd', value: typeof r.value === 'number' ? r.value.toFixed(1) : String(r.value) })
                        } else if (r.source === 'simkl' && r.value && !has('simkl')) {
                            results.push({ source: 'simkl', value: typeof r.value === 'number' ? (r.value > 10 ? (r.value / 10).toFixed(1) : r.value.toFixed(1)) : String(r.value) })
                        }
                    }
                }
                if (DEV) console.log('[trace] mdblist: +%d ratings (%s)', results.length - before, results.slice(before).map(r => r.source).join(', ') || 'none')
            }
        } catch (e) { if (DEV) console.warn('[trace] mdblist: FAILED', e) }
    }

    if (imdbId.startsWith('tt')) {
        try {
            const omdbRes = await fetch(`https://www.omdbapi.com/?i=${encodeURIComponent(imdbId)}&apikey=trilogy`)
            if (DEV) console.log('[trace] omdb: status=%d ok=%b', omdbRes.status, omdbRes.ok)
            if (omdbRes.ok) {
                const data = await omdbRes.json()
                const before = results.length
                if (Array.isArray(data?.Ratings)) {
                    for (const r of data.Ratings) {
                        if (r.Source === 'Rotten Tomatoes' && r.Value && !has('tomatoes')) {
                            results.push({ source: 'tomatoes', value: r.Value })
                        } else if (r.Source === 'Metacritic' && r.Value && !has('metacritic')) {
                            results.push({ source: 'metacritic', value: r.Value.split('/')[0] })
                        }
                    }
                }
                if (data?.Metascore && data.Metascore !== 'N/A' && !has('metacritic')) {
                    results.push({ source: 'metacritic', value: data.Metascore })
                }
                if (DEV) console.log('[trace] omdb: +%d ratings (%s)', results.length - before, results.slice(before).map(r => r.source).join(', ') || 'none')
            }
        } catch (e) { if (DEV) console.warn('[trace] omdb: FAILED', e) }
    }

    if (DEV) console.log('[trace] fetchAdditionalRatings: total=%d sources=[%s]', results.length, results.map(r => r.source).join(', '))
    return results
}

const mergeProviderRatings = (prev: ProviderRating[], extra: ProviderRating[]): ProviderRating[] => {
    const combined = [...prev]
    for (const item of extra) {
        if (!combined.some(x => x.source === item.source)) combined.push(item)
    }
    return combined
}


function getYear(meta: CinemetaMeta | null, item: DetailItem | null): string {
    if (meta?.released) return meta.released.slice(0, 4)
    if (meta?.year) return meta.year
    if (item?.firstWatched) {
        const y = new Date(item.firstWatched).getFullYear()
        if (!isNaN(y)) return String(y)
    }
    if (item?.year) return String(item.year)
    return ''
}

function getGenres(meta: CinemetaMeta | null, item: DetailItem | null): string[] {
    if (meta?.genre && typeof meta.genre === 'string') {
        const parsed = meta.genre.split(',').map(g => g.trim()).filter(Boolean)
        if (parsed.length > 0) return parsed
    }
    return item?.genres ?? []
}

function getDirectors(meta: CinemetaMeta | null): Array<{ name: string; photo?: string }> {
    if (!meta?.director) return []
    if (Array.isArray(meta.director)) {
        return (meta.director as Array<string | { name?: string; photo?: string }>)
            .map(d => {
                if (typeof d === 'string') return { name: d }
                return {
                    name: typeof d?.name === 'string' ? d.name : '',
                    photo: typeof d?.photo === 'string' ? d.photo : undefined,
                }
            })
            .filter(d => d.name.trim().length > 0 && !/^https?:\/\//i.test(d.name))
    }
    if (typeof meta.director === 'string') {
        return meta.director
            .split(',')
            .map(d => d.trim())
            .filter(d => d.length > 0 && !/^https?:\/\//i.test(d))
            .map(name => ({ name }))
    }
    return []
}

function getCrew(meta: CinemetaMeta | null): Array<{ name: string; role?: string; photo?: string }> {
    if (meta?.crew && Array.isArray(meta.crew) && meta.crew.length > 0) {
        return meta.crew
    }
    const directors = getDirectors(meta)
    return directors.map(d => ({ name: d.name, role: 'Director', photo: d.photo }))
}

/**
 * Cinemeta returns cast as either:
 *   - string[]  (just names, e.g. ["Matthew McConaughey", "Anne Hathaway"])
 *   - CinemetaCastMember[] (rich objects from TMDB enrichment or AIOMetadata)
 * This helper normalises both into the rich shape the UI expects.
 */
function getCast(
    meta: CinemetaMeta | null,
): Array<{ name: string; character?: string; photo?: string }> {
    if (!meta?.cast || meta.cast.length === 0) return []
    return (meta.cast as Array<string | CinemetaCastMember>)
        .map(c => {
            if (typeof c === 'string') return { name: c }
            return {
                name: typeof c?.name === 'string' ? c.name : '',
                character: typeof c?.character === 'string' ? c.character : undefined,
                photo: typeof c?.photo === 'string' ? c.photo : undefined,
            }
        })
        .filter(c => c.name.trim().length > 0)
        .slice(0, CAST_DISPLAY_LIMIT)
}

function isStremioFriendlyType(type: string): boolean {
    return type === 'movie' || type === 'series'
}

const personPhotoCache = new Map<string, string | null>()
const PERSON_PHOTO_CACHE_MAX = 1000
function setPersonPhotoCache(key: string, value: string | null) {
    personPhotoCache.set(key, value)
    if (personPhotoCache.size > PERSON_PHOTO_CACHE_MAX) {
        const oldest = personPhotoCache.keys().next().value
        if (oldest !== undefined) personPhotoCache.delete(oldest)
    }
}
const inFlightPhotos = new Map<string, Promise<string | null>>()

const PHOTO_CACHE_KEY = 'aiom_person_photos'
const PHOTO_CACHE_TTL = 7 * 24 * 60 * 60 * 1000
let photoStoreLoaded = false

async function ensurePhotoStoreLoaded(): Promise<void> {
    if (photoStoreLoaded) return
    photoStoreLoaded = true
    try {
        const stored = await localforage.getItem<{ entries: Record<string, { url: string | null; ts: number }>; ts: number }>(PHOTO_CACHE_KEY)
        if (stored && Date.now() - stored.ts < PHOTO_CACHE_TTL) {
            for (const [name, entry] of Object.entries(stored.entries)) {
                setPersonPhotoCache(name, entry.url)
            }
        }
    } catch { }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null

function persistPhotoStore(): void {
    try {
        const entries: Record<string, { url: string | null; ts: number }> = {}
        for (const [name, url] of personPhotoCache) {
            entries[name] = { url, ts: Date.now() }
        }
        localforage.setItem(PHOTO_CACHE_KEY, { entries, ts: Date.now() })
    } catch { }
}

function debouncedPersist(): void {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(persistPhotoStore, 2000)
}

async function resolvePersonPhoto(name: string): Promise<string | null> {
    const key = name.trim().toLowerCase()
    if (!key) return null
    if (personPhotoCache.has(key)) return personPhotoCache.get(key) ?? null
    if (inFlightPhotos.has(key)) return inFlightPhotos.get(key)!
    const promise = (async () => {
        try {
            const person = await searchTmdbPerson(name.trim())
            const path = person?.profilePath
            const url = path ? `https://image.tmdb.org/t/p/w185${path}` : null
            setPersonPhotoCache(key, url)
            return url
        } catch {
            setPersonPhotoCache(key, null)
            return null
        } finally {
            inFlightPhotos.delete(key)
        }
    })()
    inFlightPhotos.set(key, promise)
    return promise
}

export interface FilmographyItem {
    id: string
    title: string
    poster?: string
    year?: number
    type: 'movie' | 'series' | 'anime'
    character?: string
    job?: string
    voteAverage?: number
}

export interface PersonDetails {
    name: string
    photo?: string
    biography?: string
    birthday?: string
    deathday?: string
    placeOfBirth?: string
    knownFor?: string
}

export interface PersonFilmographyResult {
    person: PersonDetails
    movies: FilmographyItem[]
    series: FilmographyItem[]
    anime: FilmographyItem[]
}

export type NavEntry =
    | {
        kind: 'item'
        item: DetailItem
    }
    | {
        kind: 'person'
        name: string
        photo?: string
        role?: string
        biography?: string
        birthday?: string
        deathday?: string
        placeOfBirth?: string
        knownFor?: string
        movies: FilmographyItem[]
        series: FilmographyItem[]
        anime: FilmographyItem[]
        loading: boolean
        activeTab: 'all' | 'movies' | 'series' | 'anime'
    }
    | {
        kind: 'account'
        accountId: string
        accountName: string
    }

function calculateAge(birthday?: string, deathday?: string | null): number | null {
    if (!birthday) return null
    const birth = new Date(birthday)
    if (isNaN(birth.getTime())) return null
    const end = deathday ? new Date(deathday) : new Date()
    let age = end.getFullYear() - birth.getFullYear()
    const m = end.getMonth() - birth.getMonth()
    if (m < 0 || (m === 0 && end.getDate() < birth.getDate())) {
        age--
    }
    return age >= 0 ? age : null
}

function formatPersonBirthInfo(birthday?: string, placeOfBirth?: string, deathday?: string): string | undefined {
    if (!birthday && !placeOfBirth) return undefined
    const parts: string[] = []
    if (birthday) {
        const birthDate = new Date(birthday)
        if (!isNaN(birthDate.getTime())) {
            const formattedDate = birthDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
            const age = calculateAge(birthday, deathday)
            if (deathday) {
                parts.push(`Born ${formattedDate} (Died ${new Date(deathday).getFullYear()})`)
            } else if (age !== null) {
                parts.push(`Born ${formattedDate} (age ${age})`)
            } else {
                parts.push(`Born ${formattedDate}`)
            }
        }
    }
    if (placeOfBirth) {
        parts.push(birthday ? `in ${placeOfBirth}` : `Born in ${placeOfBirth}`)
    }
    return parts.join(' ')
}

function formatRuntime(runtimeStr?: string): string | undefined {
    if (!runtimeStr) return undefined
    const num = parseInt(runtimeStr.replace(/[^0-9]/g, ''), 10)
    if (!num || isNaN(num)) return runtimeStr
    const hrs = Math.floor(num / 60)
    const mins = num % 60
    if (hrs > 0 && mins > 0) return `${hrs}h ${mins}m`
    if (hrs > 0) return `${hrs}h`
    return `${mins}m`
}

async function fetchPersonFilmography(
    personName: string,
    currentFilm?: FilmographyItem | null
): Promise<PersonFilmographyResult> {
    const ensureCurrentFilm = (res: PersonFilmographyResult): PersonFilmographyResult => {
        if (!currentFilm) return res
        const normTitle = currentFilm.title.toLowerCase().trim()
        const allItems = [...res.movies, ...res.series, ...res.anime]
        const exists = allItems.some(i => i.id === currentFilm.id || i.title.toLowerCase().trim() === normTitle)
        if (!exists) {
            if (currentFilm.type === 'movie') {
                res.movies = [currentFilm, ...res.movies]
            } else if (currentFilm.type === 'anime') {
                res.anime = [currentFilm, ...res.anime]
            } else {
                res.series = [currentFilm, ...res.series]
            }
        }
        return res
    }

    // 1. Query TMDB search + person details with combined_credits via authenticated proxyFetch
    try {
        const searchData = await proxyFetch<any>(`search/person?query=${encodeURIComponent(personName)}`)
        if (searchData && Array.isArray(searchData.results) && searchData.results.length > 0) {
            const searchPerson = searchData.results[0]
            const personId = searchPerson.id

            const personData = await proxyFetch<any>(`person/${personId}?append_to_response=combined_credits`)
            if (personData) {
                const photo = personData.profile_path ? `https://image.tmdb.org/t/p/w500${personData.profile_path}` : (searchPerson.profile_path ? `https://image.tmdb.org/t/p/w500${searchPerson.profile_path}` : undefined)
                const creditsData = personData.combined_credits
                const rawCast: any[] = Array.isArray(creditsData.cast) ? creditsData.cast : []
                const rawCrew: any[] = Array.isArray(creditsData.crew) ? creditsData.crew : []

                const combined = [...rawCast, ...rawCrew]
                const movieMap = new Map<string, FilmographyItem>()
                const seriesMap = new Map<string, FilmographyItem>()
                const animeMap = new Map<string, FilmographyItem>()

                for (const item of combined) {
                    const title = item.title || item.name
                    if (!title) continue
                    const date = item.release_date || item.first_air_date || ''
                    const year = date ? parseInt(date.slice(0, 4), 10) : undefined
                    const isTv = item.media_type === 'tv'
                    const genreIds = Array.isArray(item.genre_ids) ? item.genre_ids : []
                    const origLang = item.original_language || ''
                    const isAnimation = genreIds.includes(16)
                    const isAnimeItem = isTv && isAnimation && (origLang === 'ja' || (Array.isArray(item.origin_country) && item.origin_country.includes('JP')))

                    const poster = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : undefined
                    const targetMap = !isTv ? movieMap : isAnimeItem ? animeMap : seriesMap
                    const itemId = item.id ? `tmdb:${item.id}` : ''

                    if (itemId && !targetMap.has(itemId)) {
                        targetMap.set(itemId, {
                            id: itemId,
                            title,
                            poster,
                            year,
                            type: !isTv ? 'movie' : isAnimeItem ? 'anime' : 'series',
                            character: item.character,
                            job: item.job || item.department,
                            voteAverage: item.vote_average,
                        })
                    }
                }

                const movies = Array.from(movieMap.values()).sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
                const series = Array.from(seriesMap.values()).sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
                const anime = Array.from(animeMap.values()).sort((a, b) => (b.year ?? 0) - (a.year ?? 0))

                if (movies.length > 0 || series.length > 0 || anime.length > 0) {
                    return ensureCurrentFilm({
                        person: {
                            name: personData.name || personName,
                            photo,
                            biography: personData.biography?.trim() || undefined,
                            birthday: personData.birthday || undefined,
                            deathday: personData.deathday || undefined,
                            placeOfBirth: personData.place_of_birth || undefined,
                            knownFor: personData.known_for_department || undefined,
                        },
                        movies,
                        series,
                        anime,
                    })
                }
            }
        }
    } catch (e) { if (import.meta.env?.DEV) console.warn('[ActivityDetail] fetch failed:', e) }

    return ensureCurrentFilm({ person: { name: personName }, movies: [], series: [], anime: [] })
}

function getCastPhotoUrl(photo?: string): string | null {
    if (!photo) return null
    if (photo.startsWith('http')) return photo
    return `https://image.tmdb.org/t/p/w500${photo.startsWith('/') ? '' : '/'}${photo}`
}

/** Initials avatar for cast members without a photo */
const CastInitials = memo(function CastInitials({ name }: { name: string }) {
    const initials = name
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map(w => w[0].toUpperCase())
        .join('')
    return (
        <div className="flex h-full w-full items-center justify-center bg-muted/90 text-sm font-bold text-foreground/70 transition-transform duration-300 group-hover:scale-105">
            {initials}
        </div>
    )
})

// ── ReviewCard: expandable community review with source attribution ─────

const ReviewCard = memo(function ReviewCard({ rv }: { rv: { author: string; content: string; rating?: number; avatar?: string } }) {
    const [expanded, setExpanded] = useState(false)
    const isLong = rv.content.length > 220
    const displayText = !expanded && isLong ? rv.content.slice(0, 220) + '…' : rv.content

    return (
        <div className="flex flex-col justify-between rounded-2xl border border-border/40 bg-card/60 p-4 shadow-sm backdrop-blur-md space-y-2.5">
            <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-primary/40 bg-muted font-bold text-xs text-primary shadow">
                    {rv.avatar ? (
                        <img src={rv.avatar} alt={rv.author} className="h-full w-full object-cover" />
                    ) : (
                        rv.author.charAt(0).toUpperCase()
                    )}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <p className="truncate text-xs font-bold text-foreground">{rv.author}</p>
                        <span className="rounded border border-[#01b4e4]/30 bg-[#0d253f]/60 px-1.5 py-0.2 text-[9px] font-black leading-none text-[#01b4e4]/80 uppercase tracking-wide">
                            Via TMDB
                        </span>
                    </div>
                    {rv.rating && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-black text-amber-400">
                            ★ {rv.rating}/10
                        </span>
                    )}
                </div>
            </div>
            <div>
                <p className="text-xs leading-relaxed text-muted-foreground/90 font-medium italic">
                    "{displayText}"
                </p>
                {isLong && (
                    <button
                        type="button"
                        onClick={() => setExpanded(e => !e)}
                        className="mt-1.5 flex items-center gap-1 text-[10px] font-bold text-primary/80 hover:text-primary transition-colors"
                    >
                        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        {expanded ? 'Show less' : 'Read more'}
                    </button>
                )}
            </div>
        </div>
    )
})

const CastAvatar = memo(function CastAvatar({ person }: { person: { name: string; photo?: string } }) {
    const photoUrl = getCastPhotoUrl(person.photo)

    if (photoUrl) {
        return (
            <img
                src={photoUrl}
                alt={person.name}
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                loading="lazy"
                onError={() => { }}
            />
        )
    }

    return <CastInitials name={person.name} />
})

const WatcherBadges = memo(function WatcherBadges({ watchers }: { watchers: RailWatcher[] }) {
    if (!watchers || watchers.length === 0) return null
    return (
        <div className="absolute bottom-2 right-2 z-10 flex items-center -space-x-1.5">
            {watchers.slice(0, 3).map(w => (
                <div key={w.id} className="h-5 w-5 rounded-full border border-background overflow-hidden bg-card shadow-sm flex items-center justify-center">
                    {w.avatar ? (
                        <img src={w.avatar} alt="" className="h-full w-full object-cover" loading="lazy" />
                    ) : w.emoji ? (
                        <span className="text-[9px]">{w.emoji}</span>
                    ) : (
                        <span className="text-[8px] font-bold text-muted-foreground">{(w.name.charAt(0) || '?').toUpperCase()}</span>
                    )}
                </div>
            ))}
            {watchers.length > 3 && (
                <div className="h-5 w-5 rounded-full border border-background bg-card shadow-sm flex items-center justify-center">
                    <span className="text-[8px] font-bold text-muted-foreground">+{watchers.length - 3}</span>
                </div>
            )}
        </div>
    )
})

type CastSectionPerson = { name: string; character?: string; photo?: string }
type CastSectionCrew = { name: string; role?: string; photo?: string }

const CastSection = memo(function CastSection({
    cast,
    crew,
    onPersonClick
}: {
    cast: CastSectionPerson[]
    crew: CastSectionCrew[]
    isLight: boolean
    onPersonClick: (person: { name: string; photo?: string }, role: string) => void
}) {
    const scrollCastRef = useRef<HTMLDivElement>(null)
    const scrollCrewRef = useRef<HTMLDivElement>(null)
    const [resolvedCast, setResolvedCast] = useState<CastSectionPerson[]>(cast)
    const [resolvedCrew, setResolvedCrew] = useState<CastSectionCrew[]>(crew)

    useEffect(() => {
        let active = true
        setResolvedCast(cast)
        setResolvedCrew(crew)

        type Target = 'cast' | 'crew'
        const pending: Array<{ idx: number; name: string; target: Target }> = []
        for (let i = 0; i < cast.length; i++) {
            const entry = cast[i]
            if (entry && !entry.photo && entry.name) pending.push({ idx: i, name: entry.name, target: 'cast' })
        }
        for (let i = 0; i < crew.length; i++) {
            const entry = crew[i]
            if (entry && !entry.photo && entry.name) pending.push({ idx: i, name: entry.name, target: 'crew' })
        }
        if (pending.length === 0) return

        const CONCURRENCY = 5
        performance.mark('detail:cast:start')

        const fetchPhotos = async () => {
            await ensurePhotoStoreLoaded()
            for (let i = 0; i < pending.length; i += CONCURRENCY) {
                const batch = pending.slice(i, i + CONCURRENCY)
                await Promise.all(batch.map(async (p) => {
                    const photo = await resolvePersonPhoto(p.name)
                    if (!photo || !active) return
                    if (p.target === 'cast') {
                        setResolvedCast(prev => {
                            const next = [...prev]
                            const existing = next[p.idx]
                            if (existing) next[p.idx] = { ...existing, photo }
                            return next
                        })
                    } else {
                        setResolvedCrew(prev => {
                            const next = [...prev]
                            const existing = next[p.idx]
                            if (existing) next[p.idx] = { ...existing, photo }
                            return next
                        })
                    }
                }))
                if (active) debouncedPersist()
            }
            performance.mark('detail:cast:end')
            performance.measure('detail:cast', 'detail:cast:start', 'detail:cast:end')
        }

        fetchPhotos()
        return () => { active = false }
    }, [cast, crew])

    return (
        <>
            {resolvedCast.length > 0 && (
                <div>
                    <div className="mb-3 flex items-center justify-between">
                        <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground/80">
                            <User className="h-3.5 w-3.5 text-primary" />
                            Cast
                        </h3>
                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                onClick={() => scrollCastRef.current?.scrollBy({ left: -320, behavior: 'smooth' })}
                                aria-label="Scroll cast left"
                                className="flex h-7 w-7 items-center justify-center rounded-full border border-border/40 bg-muted/60 text-muted-foreground shadow-sm transition-all hover:bg-accent hover:text-foreground active:scale-95"
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </button>
                            <button
                                type="button"
                                onClick={() => scrollCastRef.current?.scrollBy({ left: 320, behavior: 'smooth' })}
                                aria-label="Scroll cast right"
                                className="flex h-7 w-7 items-center justify-center rounded-full border border-border/40 bg-muted/60 text-muted-foreground shadow-sm transition-all hover:bg-accent hover:text-foreground active:scale-95"
                            >
                                <ChevronRight className="h-4 w-4" />
                            </button>
                        </div>
                    </div>

                    <div ref={scrollCastRef} className="scrollbar-hide -mx-1 flex gap-4 overflow-x-auto px-1 pb-1 scroll-smooth">
                        {resolvedCast.map((person, idx) => (
                            <Tooltip key={`cast-${person.name}-${idx}`} content={`View ${person.name}'s filmography`}>
                                <button
                                    type="button"
                                    onClick={() => onPersonClick(person, 'Actor')}
                                    className="group flex w-16 shrink-0 flex-col items-center gap-1.5 focus:outline-none sm:w-20"
                                >
                                    <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full border-2 border-border/40 bg-muted shadow-md transition-[transform,opacity,box-shadow] duration-200 group-hover:border-primary/50 group-hover:shadow-lg sm:h-20 sm:w-20">
                                        <CastAvatar person={person} />
                                    </div>
                                    <div className="w-full text-center">
                                        <p className="line-clamp-2 text-[11px] font-semibold leading-tight text-foreground/90 group-hover:text-primary">
                                            {person.name}
                                        </p>
                                        {person.character && (
                                            <p className="mt-0.5 line-clamp-1 text-[10px] leading-tight text-muted-foreground/70">
                                                {person.character}
                                            </p>
                                        )}
                                    </div>
                                </button>
                            </Tooltip>
                        ))}
                    </div>
                </div>
            )}

            {resolvedCrew.length > 0 && (
                <div>
                    <div className="mb-3 flex items-center justify-between">
                        <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground/80">
                            <Clapperboard className="h-3.5 w-3.5 text-primary" />
                            Crew & Directors
                        </h3>
                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                onClick={() => scrollCrewRef.current?.scrollBy({ left: -320, behavior: 'smooth' })}
                                aria-label="Scroll crew left"
                                className="flex h-7 w-7 items-center justify-center rounded-full border border-border/40 bg-muted/60 text-muted-foreground shadow-sm transition-all hover:bg-accent hover:text-foreground active:scale-95"
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </button>
                            <button
                                type="button"
                                onClick={() => scrollCrewRef.current?.scrollBy({ left: 320, behavior: 'smooth' })}
                                aria-label="Scroll crew right"
                                className="flex h-7 w-7 items-center justify-center rounded-full border border-border/40 bg-muted/60 text-muted-foreground shadow-sm transition-all hover:bg-accent hover:text-foreground active:scale-95"
                            >
                                <ChevronRight className="h-4 w-4" />
                            </button>
                        </div>
                    </div>

                    <div ref={scrollCrewRef} className="scrollbar-hide -mx-1 flex gap-4 overflow-x-auto px-1 pb-1 scroll-smooth">
                        {resolvedCrew.map((person, idx) => (
                            <Tooltip key={`crew-${person.name}-${idx}`} content={`View ${person.name}'s filmography`}>
                                <button
                                    type="button"
                                    onClick={() => onPersonClick(person, person.role || 'Crew')}
                                    className="group flex w-16 shrink-0 flex-col items-center gap-1.5 focus:outline-none sm:w-20"
                                >
                                    <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full border-2 border-border/40 bg-muted shadow-md transition-[transform,opacity,box-shadow] duration-200 group-hover:border-primary/50 group-hover:shadow-lg sm:h-20 sm:w-20">
                                        <CastAvatar person={person} />
                                    </div>
                                    <div className="w-full text-center">
                                        <p className="line-clamp-2 text-[11px] font-semibold leading-tight text-foreground/90 group-hover:text-primary">
                                            {person.name}
                                        </p>
                                        <p className="mt-0.5 line-clamp-1 text-[10px] font-bold text-primary/80 leading-tight">
                                            {person.role || 'Crew'}
                                        </p>
                                    </div>
                                </button>
                            </Tooltip>
                        ))}
                    </div>
                </div>
            )}
        </>
    )
})

// ── Component ─────────────────────────────────────────────────────────────

interface SeasonBrowserProps {
    seriesTmdbId: number | null
    activeItem: DetailItem | null
    isLight: boolean
    loading: boolean
}

function SeasonBrowser({ seriesTmdbId, activeItem, isLight, loading }: SeasonBrowserProps) {
    const [seasons, setSeasons] = useState<SeasonInfo[]>([])
    const [selectedSeason, setSelectedSeason] = useState<number | null>(null)
    const [episodes, setEpisodes] = useState<EpisodeInfo[]>([])
    const [episodesLoading, setEpisodesLoading] = useState(false)
    const [expandedEpisode, setExpandedEpisode] = useState<number | null>(null)
    const [cinemetaSeasons, setCinemetaSeasons] = useState<SeasonInfo[]>([])
    const [cinemetaEpisodesBySeason, setCinemetaEpisodesBySeason] = useState<Map<number, EpisodeInfo[]>>(new Map())
    const [tmdbSeasonsFailed, setTmdbSeasonsFailed] = useState(false)

    useEffect(() => {
        setSeasons([])
        setSelectedSeason(null)
        setEpisodes([])
        setExpandedEpisode(null)
    }, [activeItem])

    useEffect(() => {
        if (!seriesTmdbId) return
        let active = true
        setTmdbSeasonsFailed(false)
        fetchSeasonsList(seriesTmdbId)
            .then(list => {
                if (!active) return
                const filtered = list.filter(s => s.seasonNumber > 0)
                if (filtered.length === 0) { setTmdbSeasonsFailed(true); return }
                setSeasons(filtered)
                const watched = activeItem?.season
                const target = watched != null && filtered.some(s => s.seasonNumber === watched)
                    ? watched
                    : filtered[0].seasonNumber
                setSelectedSeason(target)
            })
            .catch(() => { if (active) setTmdbSeasonsFailed(true) })
        return () => { active = false }
    }, [seriesTmdbId])

    useEffect(() => {
        if (!seriesTmdbId || selectedSeason === null) return
        let active = true
        const controller = new AbortController()
        setEpisodesLoading(true)
        setExpandedEpisode(null)
        fetchSeasonEpisodes(seriesTmdbId, selectedSeason, controller.signal)
            .then(eps => {
                if (!active || controller.signal.aborted) return
                setEpisodes(eps)
                const watched = activeItem?.episode
                if (watched != null && eps.some(e => e.episodeNumber === watched)) {
                    setExpandedEpisode(watched)
                }
            })
            .catch(() => { })
            .finally(() => { if (active && !controller.signal.aborted) setEpisodesLoading(false) })
        return () => { active = false; controller.abort() }
    }, [seriesTmdbId, selectedSeason])

    useEffect(() => {
        setCinemetaSeasons([])
        setCinemetaEpisodesBySeason(new Map())
        if (!activeItem) return
        if (seriesTmdbId && !tmdbSeasonsFailed) return
        const isSeries = activeItem.type === 'series' || activeItem.type === 'anime' || activeItem.type === 'episode'
        if (!isSeries) return
        let active = true
        const fetchCinemeta = (imdb: string) => {
            fetch(`https://v3-cinemeta.strem.io/meta/series/${encodeURIComponent(imdb)}.json`)
                .then(res => res.ok ? res.json() : null)
                .then(data => {
                    if (!active || !data?.meta?.videos) return
                    const vids: Array<Record<string, unknown>> = data.meta.videos
                    const bySeason = new Map<number, EpisodeInfo[]>()
                    const seasonSet = new Set<number>()
                    for (const v of vids) {
                        const season = typeof v.season === 'number' ? v.season : 1
                        const episode = typeof v.episode === 'number' ? v.episode : typeof v.number === 'number' ? v.number : 0
                        if (season < 1 || episode < 1) continue
                        seasonSet.add(season)
                        const ep: EpisodeInfo = {
                            episodeNumber: episode,
                            name: String(v.name || v.title || `Episode ${episode}`),
                            overview: typeof v.overview === 'string' ? v.overview : typeof v.description === 'string' ? v.description : undefined,
                            airDate: typeof v.released === 'string' ? v.released : typeof v.firstAired === 'string' ? v.firstAired : undefined,
                            still: typeof v.thumbnail === 'string' ? v.thumbnail : undefined,
                        }
                        const arr = bySeason.get(season) ?? []
                        arr.push(ep)
                        bySeason.set(season, arr)
                    }
                    for (const arr of bySeason.values()) arr.sort((a, b) => a.episodeNumber - b.episodeNumber)
                    const seasonList: SeasonInfo[] = Array.from(seasonSet)
                        .sort((a, b) => b - a)
                        .map(sn => ({
                            seasonNumber: sn,
                            name: sn === 0 ? 'Specials' : `Season ${sn}`,
                            episodeCount: bySeason.get(sn)?.length ?? 0,
                        }))
                    if (active && seasonList.length > 0) {
                        setCinemetaSeasons(seasonList)
                        setCinemetaEpisodesBySeason(bySeason)
                    }
                })
                .catch(() => { })
        }
        const itemId = activeItem.itemId
        if (itemId.startsWith('tt')) {
            fetchCinemeta(itemId)
        } else if (seriesTmdbId && tmdbSeasonsFailed) {
            proxyFetch<{ imdb_id?: string }>(`tv/${seriesTmdbId}/external_ids`)
                .then(ext => {
                    if (!active) return
                    if (ext?.imdb_id) {
                        fetchCinemeta(ext.imdb_id)
                    } else if (activeItem.name) {
                        fetch(`https://v3-cinemeta.strem.io/catalog/search/top/search=${encodeURIComponent(activeItem.name)}.json`)
                            .then(r => r.ok ? r.json() : null)
                            .then(data => {
                                if (!active || !data?.metas?.[0]) return
                                const match = data.metas.find((m: Record<string, unknown>) =>
                                    m.type === 'series' &&
                                    String(m.name || '').toLowerCase() === activeItem.name!.toLowerCase()
                                ) || data.metas[0]
                                if (match?.id && String(match.id).startsWith('tt')) {
                                    fetchCinemeta(String(match.id))
                                }
                            })
                            .catch(() => {})
                    }
                })
                .catch(() => {})
        }
        return () => { active = false }
    }, [seriesTmdbId, activeItem, tmdbSeasonsFailed])

    useEffect(() => {
        if ((seriesTmdbId && !tmdbSeasonsFailed) || cinemetaSeasons.length === 0 || selectedSeason !== null) return
        const watched = activeItem?.season
        const target = watched != null && cinemetaSeasons.some(s => s.seasonNumber === watched)
            ? watched
            : cinemetaSeasons[0].seasonNumber
        setSelectedSeason(target)
    }, [cinemetaSeasons, seriesTmdbId, selectedSeason, activeItem, tmdbSeasonsFailed])

    if (loading || (seasons.length === 0 && cinemetaSeasons.length === 0)) return null

    const activeSeasons = seasons.length > 0 ? seasons : cinemetaSeasons
    const activeEpisodes = seriesTmdbId ? episodes : (cinemetaEpisodesBySeason.get(selectedSeason ?? -1) ?? [])
    const isLoadingEps = seriesTmdbId ? episodesLoading : false

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
                <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground/80">
                    <Tv className="h-3.5 w-3.5 text-primary" />
                    Episodes
                </h3>
                {selectedSeason !== null && (() => {
                    const s = activeSeasons.find(x => x.seasonNumber === selectedSeason)
                    return s ? (
                        <span className="text-[11px] font-medium text-muted-foreground/60">
                            {s.episodeCount} episode{s.episodeCount === 1 ? '' : 's'}
                            {s.airDate ? ` · ${s.airDate.slice(0, 4)}` : ''}
                        </span>
                    ) : null
                })()}
            </div>

            <div className="scrollbar-hide -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
                {activeSeasons.map(s => {
                    const isActive = s.seasonNumber === selectedSeason
                    return (
                        <button
                            key={s.seasonNumber}
                            type="button"
                            onClick={() => setSelectedSeason(s.seasonNumber)}
                            className={cn(
                                'shrink-0 rounded-full px-4 py-2 text-xs font-bold transition-all active:scale-95',
                                isActive
                                    ? (isLight ? 'bg-primary text-primary-foreground shadow' : 'bg-white text-black shadow')
                                    : (isLight ? 'bg-muted/50 text-muted-foreground hover:bg-muted' : 'bg-white/10 text-white/80 hover:bg-white/20')
                            )}
                        >
                            {s.seasonNumber === 0 ? 'Specials' : `S${s.seasonNumber}`}
                        </button>
                    )
                })}
            </div>

            <div className="space-y-1.5">
                {isLoadingEps ? (
                    [0, 1, 2, 3].map(i => (
                        <div key={i} className="flex gap-3 rounded-xl border border-border/40 bg-muted/30 p-2.5">
                            <Skeleton className="h-14 w-24 shrink-0 rounded-lg" />
                            <div className="flex-1 space-y-1.5 py-1">
                                <Skeleton className="h-3.5 w-3/4 rounded" />
                                <Skeleton className="h-3 w-1/2 rounded" />
                            </div>
                        </div>
                    ))
                ) : activeEpisodes.length === 0 ? (
                    <p className="py-4 text-center text-xs text-muted-foreground/60">
                        No episode data available for this season.
                    </p>
                ) : (
                    activeEpisodes.map(ep => {
                        const isWatched = activeItem?.season === selectedSeason && activeItem?.episode === ep.episodeNumber
                        const isExpanded = expandedEpisode === ep.episodeNumber
                        return (
                            <button
                                key={ep.episodeNumber}
                                type="button"
                                onClick={() => setExpandedEpisode(isExpanded ? null : ep.episodeNumber)}
                                className={cn(
                                    'group flex w-full gap-3 rounded-xl border p-2 text-left transition-all',
                                    isWatched
                                        ? 'border-primary/60 bg-primary/10 shadow-sm'
                                        : 'border-border/40 bg-muted/20 hover:border-border hover:bg-muted/40'
                                )}
                            >
                                <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded-lg bg-muted sm:h-16 sm:w-28">
                                    {ep.still ? (
                                        <img src={ep.still} alt="" loading="lazy" className="h-full w-full object-cover" />
                                    ) : null}
                                    <span className={cn(
                                        'absolute left-1 top-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold leading-none',
                                        isWatched
                                            ? 'bg-primary text-primary-foreground'
                                            : 'bg-black/70 text-white'
                                    )}>
                                        E{ep.episodeNumber}
                                    </span>
                                    {isWatched && (
                                        <span className="absolute bottom-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                                            <Play className="h-2.5 w-2.5 fill-current" />
                                        </span>
                                    )}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-start justify-between gap-2">
                                        <p className={cn(
                                            'line-clamp-1 text-xs font-bold leading-tight sm:text-sm',
                                            isWatched ? 'text-primary' : 'text-foreground/90'
                                        )}>
                                            {ep.name}
                                        </p>
                                        {isWatched && (
                                            <span className="shrink-0 rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                                                Watched
                                            </span>
                                        )}
                                    </div>
                                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground/70">
                                        {ep.airDate && (
                                            <span className="inline-flex items-center gap-0.5">
                                                <Calendar className="h-3 w-3" />
                                                {ep.airDate}
                                            </span>
                                        )}
                                        {ep.runtime ? (
                                            <span className="inline-flex items-center gap-0.5">
                                                <Clock className="h-3 w-3" />
                                                {ep.runtime}m
                                            </span>
                                        ) : null}
                                        {typeof ep.voteAverage === 'number' && ep.voteAverage > 0 && (
                                            <span className="inline-flex items-center gap-0.5">
                                                <Star className="h-3 w-3" />
                                                {ep.voteAverage.toFixed(1)}
                                            </span>
                                        )}
                                    </div>
                                    {isExpanded && ep.overview && (
                                        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                                            {ep.overview}
                                        </p>
                                    )}
                                </div>
                            </button>
                        )
                    })
                )}
            </div>
        </div>
    )
}

interface ReviewsSectionProps {
    reviews: CinemetaReview[]
}

function ReviewsSection({ reviews }: ReviewsSectionProps) {
    const [showAllReviews, setShowAllReviews] = useState(false)
    const [selectedReviewSource, setSelectedReviewSource] = useState<'all' | 'TMDB' | 'Trakt'>('all')

    if (!reviews || reviews.length === 0) return null

    const filtered = reviews.filter(r => {
        if (selectedReviewSource === 'all') return true
        const src = r.source || (r.id?.startsWith('trakt') ? 'Trakt' : 'TMDB')
        return src.toLowerCase() === selectedReviewSource.toLowerCase()
    })
    const displayList = showAllReviews ? filtered : filtered.slice(0, 4)
    const traktCount = reviews.filter(r => r.source === 'Trakt' || r.id?.startsWith('trakt')).length
    const tmdbCount = reviews.filter(r => r.source === 'TMDB' || !r.id?.startsWith('trakt')).length

    return (
        <div className="mt-6 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground/80">
                    <MessageSquare className="h-3.5 w-3.5 text-primary" />
                    Audience Reviews & Discussions ({reviews.length})
                </h3>

                {/* Source Filter Sub-Tabs */}
                <div className="flex items-center gap-1 rounded-full border border-border/40 bg-muted/40 p-0.5 text-[11px] font-bold">
                    <button
                        type="button"
                        onClick={() => setSelectedReviewSource('all')}
                        className={cn(
                            'rounded-full px-2.5 py-0.5 transition-all',
                            selectedReviewSource === 'all' ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground hover:text-foreground'
                        )}
                    >
                        All ({reviews.length})
                    </button>
                    {traktCount > 0 && (
                        <button
                            type="button"
                            onClick={() => setSelectedReviewSource('Trakt')}
                            className={cn(
                                'rounded-full px-2.5 py-0.5 transition-all',
                                selectedReviewSource === 'Trakt' ? 'bg-red-600 text-white shadow' : 'text-muted-foreground hover:text-foreground'
                            )}
                        >
                            Trakt ({traktCount})
                        </button>
                    )}
                    {tmdbCount > 0 && (
                        <button
                            type="button"
                            onClick={() => setSelectedReviewSource('TMDB')}
                            className={cn(
                                'rounded-full px-2.5 py-0.5 transition-all',
                                selectedReviewSource === 'TMDB' ? 'bg-[#01b4e4] text-black shadow' : 'text-muted-foreground hover:text-foreground'
                            )}
                        >
                            TMDB ({tmdbCount})
                        </button>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                {displayList.map((rv, idx) => (
                    <ReviewCard key={`rv-${rv.id || idx}`} rv={rv} />
                ))}
            </div>

            {filtered.length > 4 && (
                <div className="flex justify-center pt-2">
                    <button
                        type="button"
                        onClick={() => setShowAllReviews(prev => !prev)}
                        className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-6 py-2 text-xs font-bold text-primary shadow transition-all hover:bg-primary/20 hover:scale-105 active:scale-95"
                    >
                        {showAllReviews ? 'Show Fewer Reviews' : `Show All Reviews (${filtered.length})`}
                    </button>
                </div>
            )}
        </div>
    )
}

interface LightboxViewerProps {
    images: string[]
    index: number | null
    zoom: boolean
    onClose: () => void
    onNavigate: (index: number) => void
    onToggleZoom: () => void
}

function LightboxViewer({ images, index, zoom, onClose, onNavigate, onToggleZoom }: LightboxViewerProps) {
    if (index === null) return null
    const src = images[index]
    if (!src) return null

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm"
            onClick={onClose}
            onKeyDown={(e) => {
                if (e.key === 'Escape') onClose()
                if (e.key === 'ArrowLeft' && index > 0) onNavigate(index - 1)
                if (e.key === 'ArrowRight' && index < images.length - 1) onNavigate(index + 1)
            }}
            tabIndex={-1}
            autoFocus
        >
            <img
                src={src}
                alt=""
                className={cn(
                    'rounded-lg object-contain shadow-2xl transition-transform duration-200 cursor-pointer',
                    zoom ? 'max-h-[100vh] max-w-[100vw] scale-150' : 'max-h-[90vh] max-w-[95vw]'
                )}
                onClick={(e) => { e.stopPropagation(); onToggleZoom() }}
                draggable={false}
            />
            {index > 0 && (
                <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onNavigate(index - 1) }}
                    className="absolute left-4 top-1/2 -translate-y-1/2 flex h-12 w-12 items-center justify-center rounded-full border border-white/20 bg-black/60 text-white shadow-lg backdrop-blur-md transition-all hover:bg-black/80 hover:scale-110"
                    aria-label="Previous image"
                >
                    <ChevronLeft className="h-6 w-6" />
                </button>
            )}
            {index < images.length - 1 && (
                <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onNavigate(index + 1) }}
                    className="absolute right-4 top-1/2 -translate-y-1/2 flex h-12 w-12 items-center justify-center rounded-full border border-white/20 bg-black/60 text-white shadow-lg backdrop-blur-md transition-all hover:bg-black/80 hover:scale-110"
                    aria-label="Next image"
                >
                    <ChevronRight className="h-6 w-6" />
                </button>
            )}
            <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onToggleZoom() }}
                className="absolute bottom-4 left-4 flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/60 text-white shadow-lg backdrop-blur-md transition-all hover:bg-black/80 hover:scale-110"
                aria-label={zoom ? 'Zoom out' : 'Zoom in'}
            >
                <ZoomIn className="h-5 w-5" />
            </button>
            <span className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white backdrop-blur-md">
                {index + 1} / {images.length}
            </span>
            <button
                type="button"
                onClick={onClose}
                className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/60 text-white shadow-lg backdrop-blur-md transition-all hover:bg-black/80 hover:scale-110"
                aria-label="Close"
            >
                <X className="h-5 w-5" />
            </button>
            <a
                href={src}
                download
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="absolute bottom-4 right-4 flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/60 text-white shadow-lg backdrop-blur-md transition-all hover:bg-black/80 hover:scale-110"
                aria-label="Open original"
            >
                <ExternalLink className="h-5 w-5" />
            </a>
        </div>
    )
}

// ── Component ─────────────────────────────────────────────────────────────

function WatchlistPicker({
    accounts,
    watchlistTargets,
    onToggle,
    loading,
}: {
    accounts: Account[]
    watchlistTargets: Set<string>
    onToggle: (id: string) => void
    loading: boolean
}) {
    const { isLight } = useTheme()
    const isPrivacyModeEnabled = useUIStore(s => s.isPrivacyModeEnabled)
    const privacyLevelNames = useUIStore(s => s.privacyLevelNames)
    const privacyLevel = isPrivacyModeEnabled ? privacyLevelNames : 0

    const heroPrimaryBtn = isLight
        ? 'bg-primary text-primary-foreground hover:bg-primary/90'
        : 'bg-white text-black hover:bg-white/90'
    const heroGhostBtn = isLight
        ? 'border border-border bg-card/80 text-foreground hover:bg-card'
        : 'border border-white/20 bg-white/10 text-white hover:bg-white/20'

    const [open, setOpen] = useState(false)
    const [search, setSearch] = useState('')
    const searchRef = useRef<HTMLInputElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const dropdownRef = useRef<HTMLDivElement>(null)
    const buttonRef = useRef<HTMLButtonElement>(null)
    const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null)

    useEffect(() => {
        if (open) {
            setSearch('')
            setTimeout(() => searchRef.current?.focus(), 0)
            const updatePos = () => {
                if (buttonRef.current) {
                    const rect = buttonRef.current.getBoundingClientRect()
                    const width = Math.max(rect.width, 280)
                    const left = Math.min(rect.left, window.innerWidth - width - 8)
                    setDropdownPos({ top: rect.bottom + 4, left: Math.max(8, left), width })
                }
            }
            updatePos()
            window.addEventListener('resize', updatePos)
            window.addEventListener('scroll', updatePos, true)
            return () => {
                window.removeEventListener('resize', updatePos)
                window.removeEventListener('scroll', updatePos, true)
            }
        } else {
            setDropdownPos(null)
        }
    }, [open])

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (
                containerRef.current && !containerRef.current.contains(e.target as Node) &&
                (!dropdownRef.current || !dropdownRef.current.contains(e.target as Node))
            ) {
                setOpen(false)
            }
        }
        if (open) document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [open])

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && open) setOpen(false)
        }
        if (open) document.addEventListener('keydown', handler)
        return () => document.removeEventListener('keydown', handler)
    }, [open])

    const filtered = useMemo(() => {
        if (!search.trim()) return accounts
        const q = search.toLowerCase()
        return accounts.filter(a =>
            (a.name || '').toLowerCase().includes(q) ||
            (a.email || '').toLowerCase().includes(q)
        )
    }, [accounts, search])

    const hasUniversal = watchlistTargets.has('')
    const hasAccounts = accounts.length > 0

    const dropdown = open && dropdownPos ? createPortal(
        <div
            ref={dropdownRef}
            style={{ position: 'fixed', top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width, zIndex: 100 }}
            className="bg-card border border-border/40 rounded-2xl shadow-lg overflow-hidden"
        >
            <div className="p-2 border-b border-border/40">
                <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <input
                        ref={searchRef}
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search accounts..."
                        className="w-full h-8 pl-8 pr-3 text-xs bg-muted/30 border border-border/40 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/30"
                    />
                </div>
            </div>
            <div className="max-h-80 overflow-y-auto p-1">
                <button
                    type="button"
                    onClick={() => onToggle('')}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs rounded-lg transition-colors ${hasUniversal ? 'bg-primary/12 text-primary border border-primary/25' : 'border border-transparent hover:bg-muted/50'}`}
                >
                    <div className="w-6 h-6 rounded-full bg-muted/40 flex items-center justify-center shrink-0">
                        <Users className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                    <span className="flex-1 text-left truncate font-semibold">Universal Watchlist</span>
                    {hasUniversal && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                </button>
                {hasAccounts && (
                    <div className="my-1 border-t border-border/40" />
                )}
                {hasAccounts && filtered.length === 0 && (
                    <div className="px-3 py-4 text-xs text-muted-foreground text-center">No accounts found</div>
                )}
                {filtered.map(acc => {
                    const selected = watchlistTargets.has(acc.id)
                    const maskedName = maskedDisplayName(acc.name, acc.email, privacyLevel)
                    return (
                        <button
                            key={acc.id}
                            type="button"
                            onClick={() => onToggle(acc.id)}
                            className={`w-full flex items-center gap-2 px-3 py-2 text-xs rounded-lg transition-colors ${selected ? 'bg-primary/12 text-primary border border-primary/25' : 'border border-transparent hover:bg-muted/50'}`}
                        >
                            <AccountSwitcherAvatar account={acc} size="sm" />
                            <span className="flex-1 text-left truncate">{maskedName || 'Unknown Account'}</span>
                            {selected && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                        </button>
                    )
                })}
            </div>
        </div>,
        document.body
    ) : null

    return (
        <div ref={containerRef} className="relative inline-flex flex-1 sm:flex-none">
            <button
                ref={buttonRef}
                type="button"
                disabled={loading}
                onClick={() => setOpen(!open)}
                className={cn('inline-flex h-11 flex-1 justify-center items-center gap-2 rounded-full px-6 text-sm font-semibold backdrop-blur-md transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50 sm:flex-none sm:w-auto sm:justify-start', watchlistTargets.size > 0 ? heroPrimaryBtn : heroGhostBtn)}
            >
                {watchlistTargets.size > 0 ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {watchlistTargets.size > 0 ? 'In a Watchlist' : 'Watchlist'}
            </button>
            {dropdown}
        </div>
    )
}

export function ActivityDetailModal({ open, onOpenChange, item }: ActivityDetailModalProps) {
    const { isLight } = useTheme()
    const [activeItem, setActiveItem] = useState<DetailItem | null>(item)
    const [meta, setMeta] = useState<CinemetaMeta | null>(null)
    const [loading, setLoading] = useState(false)
    const [failed, setFailed] = useState(false)
    const [descExpanded, setDescExpanded] = useState(false)
    const [trailer, setTrailer] = useState<TrailerResult | null>(null)
    const [providerRatings, setProviderRatings] = useState<ProviderRating[]>([])
    const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
    const [lightboxZoom, setLightboxZoom] = useState(false)

    const heroPrimaryBtn = isLight
        ? 'bg-primary text-primary-foreground hover:bg-primary/90'
        : 'bg-white text-black hover:bg-white/90'
    const heroGhostBtn = isLight
        ? 'border border-border bg-card/80 text-foreground hover:bg-card'
        : 'border border-white/20 bg-white/10 text-white hover:bg-white/20'
    const heroFrostedBtn = isLight
        ? 'border-border bg-card/80 text-foreground hover:bg-card'
        : 'border-white/15 bg-white/10 text-white/90 hover:bg-white/25'
    const heroTabActive = isLight
        ? 'bg-primary text-primary-foreground shadow'
        : 'bg-white text-black shadow'
    const heroTabInactive = isLight
        ? 'bg-muted/50 text-muted-foreground hover:bg-muted'
        : 'bg-white/10 text-white/80 hover:bg-white/20'

    const scrollGalleryRef = useRef<HTMLDivElement>(null)
    const scrollTrailersRef = useRef<HTMLDivElement>(null)
    const scrollRelatedRef = useRef<HTMLDivElement>(null)
    const trailerSectionRef = useRef<HTMLDivElement>(null)
    const [watchlistTargets, setWatchlistTargets] = useState<Set<string>>(new Set())
    const [watchlistLoading, setWatchlistLoading] = useState(false)
    const [seriesTmdbId, setSeriesTmdbId] = useState<number | null>(null)

    // Adaptive Navigation Stack
    const [navStack, setNavStack] = useState<NavEntry[]>([])
    const [bioExpanded, setBioExpanded] = useState(false)

    useEffect(() => {
        if (open && item) {
            setNavStack([{ kind: 'item', item }])
            setActiveItem(item)
            setBioExpanded(false)
        }
    }, [open, item])

    const currentEntry = navStack[navStack.length - 1] ?? (item ? { kind: 'item', item } : null)
    const previousEntry = navStack.length > 1 ? navStack[navStack.length - 2] : null

    const previousTitle = previousEntry
        ? previousEntry.kind === 'item'
            ? previousEntry.item.name || 'Details'
            : previousEntry.kind === 'person'
                ? previousEntry.name
                : previousEntry.accountName
        : ''

    const renderItem: DetailItem | null = currentEntry?.kind === 'item' ? currentEntry.item : (activeItem ?? item)

    const accounts = useAccountStore(state => state.accounts)
    const { history: allWatchHistory } = useWatchHistory()

    const isPrivacyModeEnabled = useUIStore(s => s.isPrivacyModeEnabled)
    const privacyLevelNames = useUIStore(s => s.privacyLevelNames)

    const otherWatchers = useMemo(() => {
        if (!renderItem?.itemId) return []
        const seen = new Map<string, { id: string; name: string; emoji?: string; avatar?: string; lastWatched: Date }>()
        for (const h of allWatchHistory) {
            if (h.itemId !== renderItem.itemId) continue
            if (h.accountId === renderItem?.accountId) continue
            const acc = accounts.find(a => a.id === h.accountId)
            if (!acc || acc.hideLastWatched) continue
            const prev = seen.get(h.accountId)
            if (!prev || h.timestamp > prev.lastWatched) {
                seen.set(h.accountId, { id: acc.id, name: acc.name || 'Account', emoji: acc.emoji, avatar: acc.avatar, lastWatched: h.timestamp })
            }
        }
        return [...seen.values()].sort((a, b) => b.lastWatched.getTime() - a.lastWatched.getTime())
    }, [allWatchHistory, renderItem?.itemId, accounts])

    const watchersByItemId = useMemo(() => {
        const map = new Map<string, RailWatcher[]>()
        for (const h of allWatchHistory) {
            if (!h.itemId) continue
            const acc = accounts.find(a => a.id === h.accountId)
            if (!acc || acc.hideLastWatched) continue
            const watcher: RailWatcher = { id: acc.id, name: acc.name || 'Account', emoji: acc.emoji, avatar: acc.avatar }
            const list = map.get(h.itemId)
            if (list) {
                if (!list.some(w => w.id === watcher.id)) list.push(watcher)
            } else {
                map.set(h.itemId, [watcher])
            }
        }
        return map
    }, [allWatchHistory, accounts])

    const accountFilms = useMemo(() => {
        if (currentEntry?.kind !== 'account') return null
        const films = new Map<string, { id: string; title: string; poster?: string; type: string; lastWatched: Date }>()
        for (const h of allWatchHistory) {
            if (h.accountId !== currentEntry.accountId) continue
            const type = h.type === 'episode' ? 'series' : (h.type || 'movie')
            const existing = films.get(h.itemId)
            if (!existing || h.timestamp > existing.lastWatched) {
                films.set(h.itemId, { id: h.itemId, title: h.name || 'Unknown', poster: h.poster || undefined, type, lastWatched: h.timestamp })
            }
        }
        const all = [...films.values()].sort((a, b) => b.lastWatched.getTime() - a.lastWatched.getTime())
        return {
            movies: all.filter(f => f.type === 'movie'),
            series: all.filter(f => f.type === 'series'),
            anime: all.filter(f => f.type === 'anime'),
            all,
            count: all.length,
        }
    }, [allWatchHistory, currentEntry])

    useEffect(() => {
        if (!open || !renderItem?.itemId) return
        let active = true
        const itemId = renderItem.itemId
        Promise.all([
            getWatchlist().then(items => items.some(i => i.itemId === itemId) ? [''] : []),
            ...accounts.map(a => getWatchlist(a.id).then(items => items.some(i => i.itemId === itemId) ? [a.id] : []).catch(() => []))
        ]).then(results => {
            if (!active) return
            const targets = new Set<string>()
            for (const r of results) for (const id of r) targets.add(id)
            setWatchlistTargets(targets)
        }).catch(() => { })
        return () => { active = false }
    }, [open, renderItem?.itemId, accounts])

    const handleToggleWatchlistTarget = useCallback(async (target: string) => {
        if (!renderItem?.itemId || watchlistLoading) return
        const itemId = renderItem.itemId
        const itemType = renderItem.type === 'anime' ? 'series' : renderItem.type
        const itemName = renderItem.name
        const itemPoster = renderItem.poster
        const accountId = target === '' ? undefined : target
        setWatchlistLoading(true)
        try {
            if (watchlistTargets.has(target)) {
                await traceAsync('watchlist-remove', () => removeFromWatchlist(itemId, accountId))
                setWatchlistTargets(prev => { const s = new Set(prev); s.delete(target); return s })
                toast({ title: 'Removed from Watchlist' })
            } else {
                await traceAsync('watchlist-add', () => addToWatchlist(itemId, itemType, itemName, itemPoster, accountId))
                setWatchlistTargets(prev => new Set(prev).add(target))
                toast({ title: 'Added to Watchlist', description: target === '' ? 'Available in your universal catalog' : `Added to ${accounts.find(a => a.id === target)?.name || 'account'} watchlist` })
            }
        } catch {
            toast({ variant: 'destructive', title: 'Watchlist update failed' })
        } finally {
            setWatchlistLoading(false)
        }
    }, [renderItem?.itemId, renderItem?.type, renderItem?.name, renderItem?.poster, watchlistTargets, watchlistLoading, accounts])

    const handleGoBack = () => {
        if (navStack.length > 1) {
            setNavStack(prev => prev.slice(0, -1))
            setBioExpanded(false)
        }
    }

    const handleAccountClick = useCallback((accountId: string, accountName: string) => {
        setNavStack(prev => [...prev, { kind: 'account', accountId, accountName }])
        setBioExpanded(false)
    }, [])

    const handlePersonClick = useCallback((person: { name: string; photo?: string }, role: string) => {
        const currentFilmFallback: FilmographyItem | null = renderItem ? {
            id: renderItem.itemId,
            title: renderItem.name || 'Current Title',
            poster: renderItem.poster,
            year: renderItem.year,
            type: renderItem.type === 'anime' ? 'anime' : renderItem.type === 'series' ? 'series' : 'movie',
            job: role,
        } : null

        const personEntry: NavEntry = {
            kind: 'person',
            name: person.name,
            photo: person.photo,
            role,
            movies: [],
            series: [],
            anime: [],
            loading: true,
            activeTab: 'all',
        }

        setNavStack(prev => [...prev, personEntry])
        setBioExpanded(false)

        fetchPersonFilmography(person.name, currentFilmFallback)
            .then(res => {
                setNavStack(prev => {
                    const next = [...prev]
                    const lastIdx = next.length - 1
                    if (lastIdx >= 0 && next[lastIdx].kind === 'person' && next[lastIdx].name === person.name) {
                        next[lastIdx] = {
                            ...next[lastIdx],
                            name: res.person.name || next[lastIdx].name,
                            photo: res.person.photo || next[lastIdx].photo,
                            biography: res.person.biography,
                            birthday: res.person.birthday,
                            deathday: res.person.deathday,
                            placeOfBirth: res.person.placeOfBirth,
                            knownFor: res.person.knownFor,
                            movies: res.movies,
                            series: res.series,
                            anime: res.anime,
                            loading: false,
                        }
                    }
                    return next
                })
            })
            .catch(() => {
                setNavStack(prev => {
                    const next = [...prev]
                    const lastIdx = next.length - 1
                    if (lastIdx >= 0 && next[lastIdx].kind === 'person' && next[lastIdx].name === person.name) {
                        next[lastIdx] = { ...next[lastIdx], loading: false }
                    }
                    return next
                })
            })
    }, [renderItem])

    const handleSelectFilmFromFilmography = (film: FilmographyItem) => {
        const newItem: DetailItem = {
            itemId: film.id,
            type: film.type,
            name: film.title,
            poster: film.poster,
            year: film.year,
            voteAverage: film.voteAverage,
        }
        setActiveItem(newItem)
        setNavStack(prev => [...prev, { kind: 'item', item: newItem }])
    }

    const handleSetFilmographyTab = (tab: 'all' | 'movies' | 'series' | 'anime') => {
        setNavStack(prev => {
            const next = [...prev]
            const lastIdx = next.length - 1
            if (lastIdx >= 0 && next[lastIdx].kind === 'person') {
                next[lastIdx] = { ...next[lastIdx], activeTab: tab }
            }
            return next
        })
    }

    const handleNextTrailer = () => {
        if (!meta?.videoList || meta.videoList.length === 0) return
        const currentIndex = meta.videoList.findIndex(v => v.key === trailer?.youTubeId)
        const nextIndex = (currentIndex + 1) % meta.videoList.length
        const nextVid = meta.videoList[nextIndex]
        if (nextVid) {
            setTrailer({ youTubeId: nextVid.key, source: 'tmdb' })
            toast({
                title: 'Switched Clip',
                description: `Now playing: ${nextVid.name || nextVid.type}`,
            })
        }
    }

    useEffect(() => {
        if (!open || !renderItem) return
        let active = true
        performance.mark('detail:metadata:start')
        const markMetaEnd = () => {
            performance.mark('detail:metadata:end')
            performance.measure('detail:metadata', 'detail:metadata:start', 'detail:metadata:end')
        }
        setMeta(null)
        setLoading(true)
        setFailed(false)
        setDescExpanded(false)
        setTrailer(null)
        setProviderRatings([])
        setSeriesTmdbId(null)

        const ratings: ProviderRating[] = []
        const isImdbId = renderItem.itemId.startsWith('tt')
        const tmdbMatch = renderItem.itemId.match(/^tmdb:(\d+)$/i)

        // Helper: fetch TMDB enrichment (ratings + rich cast with photos)
        const enrichFromTmdb = async (tmdbNumericId: number, mediaType: 'movie' | 'tv') => {
            const result = await traceAsync('tmdb-enrich', () => fetchTmdbDetailsAsMeta(tmdbNumericId, mediaType))
            if (!active || !result.meta) return
            setMeta(prev => {
                const merged: CinemetaMeta = prev ? { ...prev } : {} as CinemetaMeta
                if (result.meta!.cast && result.meta!.cast.length > 0) merged.cast = result.meta!.cast
                if (result.meta!.crew && result.meta!.crew.length > 0) merged.crew = result.meta!.crew
                if (result.meta!.imdbRating) merged.imdbRating = result.meta!.imdbRating
                if (result.meta!.background && !merged.background) merged.background = result.meta!.background
                if (result.meta!.poster && !merged.poster) merged.poster = result.meta!.poster
                if (result.meta!.name && !merged.name) merged.name = result.meta!.name
                if (result.meta!.description && !merged.description) merged.description = result.meta!.description
                if (result.meta!.genre && !merged.genre) merged.genre = result.meta!.genre
                if (result.meta!.runtime && !merged.runtime) merged.runtime = result.meta!.runtime
                if (result.meta!.released && !merged.released) merged.released = result.meta!.released
                if (result.meta!.year && !merged.year) merged.year = result.meta!.year
                if (result.meta!.director && !merged.director) merged.director = result.meta!.director
                if (result.meta!.certification) merged.certification = result.meta!.certification
                if (result.meta!.videoList) merged.videoList = result.meta!.videoList
                if (result.meta!.relatedList) merged.relatedList = result.meta!.relatedList
                if (result.meta!.reviewsList) merged.reviewsList = result.meta!.reviewsList
                if (result.meta!.status) merged.status = result.meta!.status
                if (result.meta!.originalLanguage) merged.originalLanguage = result.meta!.originalLanguage
                if (result.meta!.productionCompanies) merged.productionCompanies = result.meta!.productionCompanies
                if (result.meta!.networks) merged.networks = result.meta!.networks
                return merged
            })
            // Trailer: prefer TMDB key if available
            if (result.trailerYouTubeId && active) {
                setTrailer({ youTubeId: result.trailerYouTubeId, source: 'tmdb' })
            }
        }

        if (tmdbMatch) {
            // Path A: tmdb:ID — fetch directly from TMDB
            const tmdbId = Number(tmdbMatch[1])
            const mediaType = renderItem.type === 'series' || renderItem.type === 'anime' ? 'tv' : 'movie'
            if (mediaType === 'tv') setSeriesTmdbId(tmdbId)
            traceAsync('tmdb-direct', () => fetchTmdbDetailsAsMeta(tmdbId, mediaType))
                .then(result => {
                    if (!active) return
                    if (result.meta && Object.keys(result.meta).length > 0) {
                        const fullMeta: CinemetaMeta = {
                            id: renderItem.itemId,
                            type: mediaType === 'tv' ? 'series' : 'movie',
                            ...result.meta,
                        } as CinemetaMeta
                        setMeta(fullMeta)
                        setFailed(false)
                        if (result.trailerYouTubeId) {
                            setTrailer({ youTubeId: result.trailerYouTubeId, source: 'tmdb' })
                        }
                        if (result.imdbId) {
                            if (!result.trailerYouTubeId) {
                                resolveTrailerAsync({ imdbId: result.imdbId, type: renderItem.type })
                                    .then(res => { if (active) setTrailer(res) })
                                    .catch(() => { })
                            }
                            fetchAdditionalRatings(result.imdbId)
                                .then(extra => {
                                    if (active && extra.length > 0) {
                                        setProviderRatings(prev => mergeProviderRatings(prev, extra))
                                    }
                                })
                                .catch(() => { })
                        }
                    } else {
                        throw new Error('TMDB returned empty')
                    }
                })
                .catch(async (err) => {
                    if (!active) return
                    if (import.meta.env.DEV) console.warn('[ActivityDetail] TMDB path failed, trying Cinemeta fallback:', err)

                    try {
                        const fallbackImdb = await fetchTmdbImdbId(tmdbId, mediaType).catch(() => null)
                        const cinemetaId = fallbackImdb || null

                        if (cinemetaId && cinemetaId.startsWith('tt')) {
                            const cinemetaResult = await traceAsync('cinemeta-fallback', () => fetchCinemetaDetail(cinemetaId, renderItem.type))
                            if (active && cinemetaResult) {
                                setMeta(cinemetaResult)
                                setFailed(false)
                                resolveTrailerAsync({ imdbId: cinemetaId, type: renderItem.type, cinemetaMeta: cinemetaResult })
                                    .then(res => { if (active) setTrailer(res) })
                                    .catch(() => { })
                                fetchAdditionalRatings(cinemetaId)
                                    .then(extra => {
                                        if (active && extra.length > 0) {
                                            setProviderRatings(prev => mergeProviderRatings(prev, extra))
                                        }
                                    })
                                    .catch(() => { })
                            } else {
                                if (active) setFailed(true)
                            }
                        } else if (renderItem.name) {
                            const searchType = mediaType === 'tv' ? 'series' : 'movie'
                            const searchRes = await fetch(
                                `https://v3-cinemeta.strem.io/catalog/search/top/search=${encodeURIComponent(renderItem.name)}.json`
                            ).catch(() => null)
                            if (!active) return
                            if (!searchRes || !searchRes.ok) { setFailed(true); return }
                            const searchData = await searchRes.json().catch(() => null)
                            const metas: Array<{ id?: string; type?: string; name?: string }> = searchData?.metas ?? []
                            const match = metas.find(m =>
                                m.type === searchType &&
                                String(m.name || '').toLowerCase() === renderItem.name!.toLowerCase()
                            ) || metas.find(m => m.type === searchType) || metas[0]
                            if (!active) return
                            if (match?.id && String(match.id).startsWith('tt')) {
                                const cinemetaResult = await traceAsync('cinemeta-search', () =>
                                    fetchCinemetaDetail(String(match.id), renderItem.type)
                                )
                                if (!active) return
                                if (cinemetaResult) {
                                    setMeta(cinemetaResult)
                                    setFailed(false)
                                    resolveTrailerAsync({ imdbId: String(match.id), type: renderItem.type, cinemetaMeta: cinemetaResult })
                                        .then(res => { if (active) setTrailer(res) })
                                        .catch(() => { })
                                    fetchAdditionalRatings(String(match.id))
                                        .then(extra => {
                                            if (active && extra.length > 0) {
                                                setProviderRatings(prev => mergeProviderRatings(prev, extra))
                                            }
                                        })
                                        .catch(() => { })
                                } else {
                                    setFailed(true)
                                }
                            } else {
                                setFailed(true)
                            }
                        } else {
                            if (active) setFailed(true)
                        }
                    } catch {
                        if (active) setFailed(true)
                    }
                })
                .finally(() => { if (active) { markMetaEnd(); setLoading(false) } })

        } else if (isImdbId) {
            // Path B: tt* — Cinemeta baseline + TMDB enrichment in parallel
            const cinemetaPromise = traceAsync('cinemeta', () => fetchCinemetaDetail(renderItem.itemId, renderItem.type))

            // Start TMDB lookup in parallel (with auth headers)
            const tmdbEnrichPromise = proxyFetch<any>(
                `find/${encodeURIComponent(renderItem.itemId)}?external_source=imdb_id`
            ).then(data => {
                if (!data || !active) return
                const mediaType: 'movie' | 'tv' =
                    renderItem.type === 'series' || renderItem.type === 'anime' ? 'tv' : 'movie'
                const movieResult = Array.isArray(data.movie_results) && data.movie_results.length > 0
                    ? data.movie_results[0]
                    : null
                const tvResult = Array.isArray(data.tv_results) && data.tv_results.length > 0
                    ? data.tv_results[0]
                    : null
                const tmdbEntry = mediaType === 'tv'
                    ? (tvResult ?? movieResult)
                    : (movieResult ?? tvResult)
                if (!tmdbEntry?.id) return
                if (tmdbEntry === tvResult) setSeriesTmdbId(tmdbEntry.id)
                return enrichFromTmdb(tmdbEntry.id, tmdbEntry === tvResult ? 'tv' : 'movie')
            })
                .catch(() => { })

            // Kick off PMDB and additional ratings (MDBList / OMDB / RT / Metacritic) in parallel
            traceAsync('pmdb', () => getPmdbRatingFromImdb(renderItem.itemId, renderItem.type))
                .then(r => {
                    if (import.meta.env?.DEV) console.log('[trace] pmdb result:', r ? `score=${r.score}` : 'null')
                    if (!active || !r || r.score === null) return
                    ratings.push({
                        source: 'pmdb',
                        value: r.score.toFixed(1),
                    })
                    setProviderRatings([...ratings])
                })
                .catch(() => { })

            traceAsync('ratings', () => fetchAdditionalRatings(renderItem.itemId))
                .then(extra => {
                    if (!active || extra.length === 0) return
                    ratings.push(...extra)
                    setProviderRatings([...ratings])
                })
                .catch(() => { })

            fetch(`/api/metadata/comments?imdbId=${encodeURIComponent(renderItem.itemId)}&type=${encodeURIComponent(renderItem.type || '')}`)
                .then(r => r.ok ? r.json() : [])
                .then((serverComments: any[]) => {
                    if (!active || !Array.isArray(serverComments) || serverComments.length === 0) return
                    setMeta(prev => {
                        const base = prev ?? {} as CinemetaMeta
                        const existing = base.reviewsList || []
                        const combined = [...existing]
                        for (const r of serverComments) {
                            if (!combined.some(x => x.id === r.id || (x.author === r.author && x.content === r.content))) {
                                combined.push(r)
                            }
                        }
                        return { ...base, reviewsList: combined }
                    })
                })
                .catch(() => { })

            cinemetaPromise
                .then(result => {
                    if (!active) return
                    setMeta(prev => {
                        if (!prev) return result
                        return {
                            ...result,
                            cast: prev.cast && prev.cast.length > 3 ? prev.cast : (result?.cast || prev.cast),
                            crew: prev.crew && prev.crew.length > 0 ? prev.crew : (result?.crew || prev.crew),
                            director: prev.director && prev.director.length > 0 ? prev.director : (result?.director || prev.director),
                            videoList: prev.videoList || result?.videoList,
                            relatedList: prev.relatedList || result?.relatedList,
                            reviewsList: prev.reviewsList || result?.reviewsList,
                            status: prev.status || result?.status,
                            originalLanguage: prev.originalLanguage || result?.originalLanguage,
                            productionCompanies: prev.productionCompanies || result?.productionCompanies,
                            networks: prev.networks || result?.networks,
                        }
                    })
                    setFailed(result === null)
                    resolveTrailerAsync({ imdbId: renderItem.itemId, type: renderItem.type, cinemetaMeta: result })
                        .then(res => { if (!active) return; setTrailer(prev => prev ?? res) })
                        .catch(() => { })
                })
                .catch(() => { if (!active) return; setFailed(true) })
                .finally(() => {
                    if (active) { markMetaEnd(); setLoading(false) }
                    return tmdbEnrichPromise
                })

        } else {
            // Path C: unknown ID format — try Cinemeta fallback
            fetchCinemetaDetail(renderItem.itemId, renderItem.type)
                .then(result => {
                    if (!active) return
                    setMeta(result)
                    setFailed(result === null)
                    resolveTrailerAsync({ imdbId: renderItem.itemId, type: renderItem.type, cinemetaMeta: result })
                        .then(res => { if (!active) return; setTrailer(res) })
                        .catch(() => { })
                })
                .catch(() => { if (!active) return; setFailed(true) })
                .finally(() => { if (active) { markMetaEnd(); setLoading(false) } })
        }

        return () => { active = false }
    }, [open, renderItem])

    const cast = useMemo(() => getCast(meta), [meta])
    const crew = useMemo(() => getCrew(meta), [meta])

    if (!renderItem) return null

    const title = meta?.name?.trim() || renderItem.name || 'Unknown Title'
    const posterSrc = meta?.poster || renderItem.poster
    const background = meta?.background || renderItem.backdrop
    const year = getYear(meta, renderItem)
    const genres = getGenres(meta, renderItem)
    const description = meta?.description?.trim() || renderItem.description?.trim() || ''
    const rawVoteAverage = typeof renderItem.voteAverage === 'number' && renderItem.voteAverage > 0
        ? renderItem.voteAverage.toFixed(1)
        : undefined

    const imdbRating = meta?.imdbRating?.trim() || rawVoteAverage
    const runtime = meta?.runtime?.trim()
    const normalizedType = renderItem.type === 'anime' ? 'series' : renderItem.type

    const ratingMap = new Map<string, ProviderRating>()
    if (imdbRating) {
        ratingMap.set('imdb', { source: 'imdb', value: imdbRating })
    }
    if (rawVoteAverage && !ratingMap.has('imdb')) {
        ratingMap.set('tmdb', { source: 'tmdb', value: rawVoteAverage })
    }
    for (const r of providerRatings) {
        if (!ratingMap.has(r.source)) {
            ratingMap.set(r.source, r)
        }
    }
    const allRatings = Array.from(ratingMap.values())

    const dataSources: string[] = []
    if (meta) dataSources.push('Cinemeta')
    if (meta?.videoList || meta?.relatedList || meta?.reviewsList || meta?.crew) dataSources.push('TMDB')
    const hasTraktOrLetterboxd = providerRatings.some(r => r.source === 'trakt' || r.source === 'letterboxd')
    if (hasTraktOrLetterboxd) dataSources.push('MDBList')

    const canCollapse = description.length > DESCRIPTION_COLLAPSE_LENGTH

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className={cn(
                    // Override the built-in DialogContent base styles (grid, gap-4, p-4/p-6, max-w-lg, max-h)
                    '!grid-cols-none !gap-0 !p-0',
                    // Structure
                    'flex flex-col overflow-hidden',
                    '!left-0 !right-0 !top-auto !bottom-0 !translate-x-0 !translate-y-0',
                    '!max-w-full !w-full !h-[92vh] !max-h-[92vh] !rounded-t-3xl !rounded-b-none',
                    'max-[639px]:animate-in max-[639px]:slide-in-from-bottom max-[639px]:duration-300',
                    'sm:!left-[50%] sm:!right-auto sm:!top-[50%] sm:!bottom-auto sm:!translate-x-[-50%] sm:!translate-y-[-50%]',
                    'sm:!max-w-6xl sm:!max-h-[92vh] sm:!h-auto sm:!rounded-2xl bg-card text-card-foreground',
                )}
                hideClose
            >
                {currentEntry?.kind === 'person' ? (
                    /* ══ PERSON FILMOGRAPHY VIEW (Separated Movies, Series & Anime) ══════════════════ */
                    <div className="flex h-[92vh] sm:h-[88vh] flex-col overflow-hidden bg-background text-foreground">
                        {/* Person Header */}
                        <div className={cn('relative shrink-0 border-b border-border/40 px-4 py-4 sm:px-8 sm:py-5', isLight ? 'bg-muted/50 text-foreground' : 'bg-card text-white')}>
                            {/* Close button — top-right, frosted glass */}
                            <button
                                type="button"
                                onClick={() => onOpenChange(false)}
                                aria-label="Close"
                                className={cn('absolute right-4 top-4 z-30 flex h-9 w-9 items-center justify-center rounded-full border shadow-lg backdrop-blur-md transition-all hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 active:scale-95', heroFrostedBtn)}
                            >
                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                                <span className="sr-only">Close</span>
                            </button>

                            {previousEntry && (
                                <button
                                    type="button"
                                    onClick={handleGoBack}
                                    className={cn('mb-3 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-bold backdrop-blur-md transition-all active:scale-95', heroGhostBtn)}
                                >
                                    <ArrowLeft className="h-4 w-4" />
                                    Back to {previousTitle}
                                </button>
                            )}

                            <div className="flex items-start gap-3 sm:gap-6">
                                {/* Person Avatar */}
                                <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-full border-2 border-primary/60 bg-muted shadow-2xl sm:h-24 sm:w-24">
                                    {currentEntry.photo ? (
                                        <img
                                            src={currentEntry.photo.startsWith('http') ? currentEntry.photo : `${TMDB_PROFILE_BASE}${currentEntry.photo}`}
                                            alt={currentEntry.name}
                                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                                        />
                                    ) : (
                                        <CastInitials name={currentEntry.name} />
                                    )}
                                </div>

                                <div className="flex-1 min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="rounded-md bg-primary/85 px-2 py-0.5 text-[11px] font-bold uppercase tracking-widest text-primary-foreground">
                                            {currentEntry.knownFor || currentEntry.role || 'Filmography'}
                                        </span>
                                    </div>
                                    <h2 className={cn('mt-1 text-xl font-extrabold sm:text-2xl tracking-tight sm:text-4xl', isLight ? 'text-foreground' : 'text-white')}>
                                        {currentEntry.name}
                                    </h2>

                                    {/* Birth / Age / Place Info */}
                                    {(() => {
                                        const birthInfo = formatPersonBirthInfo(currentEntry.birthday, currentEntry.placeOfBirth, currentEntry.deathday)
                                        return birthInfo ? (
                                            <p className={cn('mt-1 text-xs font-medium', isLight ? 'text-muted-foreground' : 'text-white/80')}>
                                                {birthInfo}
                                            </p>
                                        ) : null
                                    })()}

                                    <p className={cn('mt-1 text-xs', isLight ? 'text-muted-foreground/70' : 'text-white/60')}>
                                        {currentEntry.loading
                                            ? 'Loading filmography...'
                                            : `${currentEntry.movies.length} Movies · ${currentEntry.series.length} TV Series${currentEntry.anime.length > 0 ? ` · ${currentEntry.anime.length} Anime` : ''}`
                                        }
                                    </p>
                                </div>
                            </div>

                            {/* Biography Card */}
                            {currentEntry.biography && (
                                <div className={cn('mt-4 rounded-xl border p-2.5 sm:p-3.5 text-xs leading-relaxed backdrop-blur-sm sm:text-sm', isLight ? 'border-border/40 bg-muted/30 text-muted-foreground' : 'border-white/10 bg-white/5 text-white/90')}>
                                    <p className={cn(!bioExpanded && 'line-clamp-3 sm:line-clamp-4')}>
                                        {currentEntry.biography}
                                    </p>
                                    {currentEntry.biography.length > 220 && (
                                        <button
                                            type="button"
                                            onClick={() => setBioExpanded(!bioExpanded)}
                                            className="mt-1.5 inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline"
                                        >
                                            {bioExpanded ? (
                                                <>Show Less <ChevronUp className="h-3 w-3" /></>
                                            ) : (
                                                <>Read Biography <ChevronDown className="h-3 w-3" /></>
                                            )}
                                        </button>
                                    )}
                                </div>
                            )}

                            {/* Category Filter Tabs */}
                            {!currentEntry.loading && (currentEntry.movies.length > 0 || currentEntry.series.length > 0 || currentEntry.anime.length > 0) && (
                                <div className="mt-4 flex items-center gap-2 pt-2 border-t border-white/10">
                                    <button
                                        type="button"
                                        onClick={() => handleSetFilmographyTab('all')}
                                        className={cn(
                                            'rounded-full px-4 py-1 text-xs font-bold transition-all',
                                            currentEntry.activeTab === 'all'
                                                ? heroTabActive
                                                : heroTabInactive
                                        )}
                                    >
                                        All ({currentEntry.movies.length + currentEntry.series.length + currentEntry.anime.length})
                                    </button>
                                    {currentEntry.movies.length > 0 && (
                                        <button
                                            type="button"
                                            onClick={() => handleSetFilmographyTab('movies')}
                                            className={cn(
                                                'rounded-full px-4 py-1 text-xs font-bold transition-all',
                                                currentEntry.activeTab === 'movies'
                                                    ? 'bg-white text-black shadow'
                                                    : 'bg-white/10 text-white/80 hover:bg-white/20'
                                            )}
                                        >
                                            Movies ({currentEntry.movies.length})
                                        </button>
                                    )}
                                    {currentEntry.series.length > 0 && (
                                        <button
                                            type="button"
                                            onClick={() => handleSetFilmographyTab('series')}
                                            className={cn(
                                                'rounded-full px-4 py-1 text-xs font-bold transition-all',
                                                currentEntry.activeTab === 'series'
                                                    ? 'bg-white text-black shadow'
                                                    : 'bg-white/10 text-white/80 hover:bg-white/20'
                                            )}
                                        >
                                            TV Series ({currentEntry.series.length})
                                        </button>
                                    )}
                                    {currentEntry.anime.length > 0 && (
                                        <button
                                            type="button"
                                            onClick={() => handleSetFilmographyTab('anime')}
                                            className={cn(
                                                'rounded-full px-4 py-1 text-xs font-bold transition-all',
                                                currentEntry.activeTab === 'anime'
                                                    ? 'bg-white text-black shadow'
                                                    : 'bg-white/10 text-white/80 hover:bg-white/20'
                                            )}
                                        >
                                            Anime ({currentEntry.anime.length})
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Filmography Posters Grid Body */}
                        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6 space-y-6 sm:space-y-8">
                            {currentEntry.loading ? (
                                <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
                                    {Array.from({ length: 12 }).map((_, i) => (
                                        <div key={i} className="space-y-2">
                                            <Skeleton className="aspect-[2/3] w-full rounded-xl" />
                                            <Skeleton className="h-3 w-3/4 rounded" />
                                        </div>
                                    ))}
                                </div>
                            ) : currentEntry.movies.length === 0 && currentEntry.series.length === 0 && currentEntry.anime.length === 0 ? (
                                <div className="flex h-64 flex-col items-center justify-center text-center">
                                    <User className="h-10 w-10 text-muted-foreground/40 mb-2" />
                                    <p className="text-sm font-medium text-muted-foreground">No filmography entries found for this person.</p>
                                </div>
                            ) : (
                                <>
                                    {/* ── MOVIES SECTION ───────────────────────────────────── */}
                                    {(currentEntry.activeTab === 'all' || currentEntry.activeTab === 'movies') && currentEntry.movies.length > 0 && (
                                        <div>
                                            <h3 className="mb-3.5 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground/80">
                                                <Film className="h-4 w-4 text-primary" />
                                                Movies ({currentEntry.movies.length})
                                            </h3>
                                            <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
                                                {currentEntry.movies.map((film, idx) => (
                                                    <button
                                                        type="button"
                                                        key={`movie-${film.id}-${idx}`}
                                                        onClick={() => handleSelectFilmFromFilmography(film)}
                                                        className="group flex flex-col items-center text-center focus:outline-none"
                                                    >
                                                        <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl bg-muted border border-border/40 shadow-sm transition-[transform,opacity,box-shadow] duration-200 group-hover:border-primary/50 group-hover:shadow-lg">
                                                            {film.poster ? (
                                                                <img
                                                                    src={film.poster}
                                                                    alt={film.title}
                                                                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                                                                    loading="lazy"
                                                                    onError={(e) => { e.currentTarget.style.visibility = 'hidden' }}
                                                                />
                                                            ) : (
                                                                <div className="flex h-full w-full items-center justify-center p-3 text-center text-xs font-bold text-muted-foreground">
                                                                    {film.title}
                                                                </div>
                                                            )}

                                                            {film.year && (
                                                                <span className="absolute right-2 top-2 rounded-md bg-black/80 px-1.5 py-0.5 text-[10px] font-bold text-white shadow backdrop-blur-sm">
                                                                    {film.year}
                                                                </span>
                                                            )}

                                                            <WatcherBadges watchers={watchersByItemId.get(film.id) ?? []} />

                                                        </div>

                                                        <div className="mt-2 flex w-full flex-col items-center px-1 text-center">
                                                            <p className="line-clamp-2 min-h-[2.25rem] flex items-center justify-center text-xs font-bold leading-tight text-foreground group-hover:text-primary">
                                                                {film.title}
                                                            </p>
                                                            {(film.character || film.job) && (
                                                                <p className="mt-0.5 line-clamp-1 text-[11px] leading-tight text-muted-foreground/70">
                                                                    {film.character ? `as ${film.character}` : film.job}
                                                                </p>
                                                            )}
                                                        </div>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* ── TV SERIES SECTION ────────────────────────────────── */}
                                    {(currentEntry.activeTab === 'all' || currentEntry.activeTab === 'series') && currentEntry.series.length > 0 && (
                                        <div>
                                            <h3 className="mb-3.5 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground/80">
                                                <Clapperboard className="h-4 w-4 text-primary" />
                                                TV Series ({currentEntry.series.length})
                                            </h3>
                                            <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
                                                {currentEntry.series.map((film, idx) => (
                                                    <button
                                                        type="button"
                                                        key={`series-${film.id}-${idx}`}
                                                        onClick={() => handleSelectFilmFromFilmography(film)}
                                                        className="group flex flex-col items-center text-center focus:outline-none"
                                                    >
                                                        <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl bg-muted border border-border/40 shadow-sm transition-[transform,opacity,box-shadow] duration-200 group-hover:border-primary/50 group-hover:shadow-lg">
                                                            {film.poster ? (
                                                                <img
                                                                    src={film.poster}
                                                                    alt={film.title}
                                                                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                                                                    loading="lazy"
                                                                    onError={(e) => { e.currentTarget.style.visibility = 'hidden' }}
                                                                />
                                                            ) : (
                                                                <div className="flex h-full w-full items-center justify-center p-3 text-center text-xs font-bold text-muted-foreground">
                                                                    {film.title}
                                                                </div>
                                                            )}

                                                            {film.year && (
                                                                <span className="absolute right-2 top-2 rounded-md bg-black/80 px-1.5 py-0.5 text-[10px] font-bold text-white shadow backdrop-blur-sm">
                                                                    {film.year}
                                                                </span>
                                                            )}

                                                            <WatcherBadges watchers={watchersByItemId.get(film.id) ?? []} />

                                                        </div>

                                                        <div className="mt-2 flex w-full flex-col items-center px-1 text-center">
                                                            <p className="line-clamp-2 min-h-[2.25rem] flex items-center justify-center text-xs font-bold leading-tight text-foreground group-hover:text-primary">
                                                                {film.title}
                                                            </p>
                                                            {(film.character || film.job) && (
                                                                <p className="mt-0.5 line-clamp-1 text-[11px] leading-tight text-muted-foreground/70">
                                                                    {film.character ? `as ${film.character}` : film.job}
                                                                </p>
                                                            )}
                                                        </div>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* ── ANIME SECTION ────────────────────────────────────── */}
                                    {(currentEntry.activeTab === 'all' || currentEntry.activeTab === 'anime') && currentEntry.anime.length > 0 && (
                                        <div>
                                            <h3 className="mb-3.5 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground/80">
                                                <Star className="h-4 w-4 text-amber-400" />
                                                Anime ({currentEntry.anime.length})
                                            </h3>
                                            <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
                                                {currentEntry.anime.map((film, idx) => (
                                                    <button
                                                        type="button"
                                                        key={`anime-${film.id}-${idx}`}
                                                        onClick={() => handleSelectFilmFromFilmography(film)}
                                                        className="group flex flex-col items-center text-center focus:outline-none"
                                                    >
                                                        <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl bg-muted border border-border/40 shadow-sm transition-[transform,opacity,box-shadow] duration-200 group-hover:border-primary/50 group-hover:shadow-lg">
                                                            {film.poster ? (
                                                                <img
                                                                    src={film.poster}
                                                                    alt={film.title}
                                                                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                                                                    loading="lazy"
                                                                    onError={(e) => { e.currentTarget.style.visibility = 'hidden' }}
                                                                />
                                                            ) : (
                                                                <div className="flex h-full w-full items-center justify-center p-3 text-center text-xs font-bold text-muted-foreground">
                                                                    {film.title}
                                                                </div>
                                                            )}

                                                            {film.year && (
                                                                <span className="absolute right-2 top-2 rounded-md bg-black/80 px-1.5 py-0.5 text-[10px] font-bold text-white shadow backdrop-blur-sm">
                                                                    {film.year}
                                                                </span>
                                                            )}

                                                            <WatcherBadges watchers={watchersByItemId.get(film.id) ?? []} />

                                                        </div>

                                                        <div className="mt-2 flex w-full flex-col items-center px-1 text-center">
                                                            <p className="line-clamp-2 min-h-[2.25rem] flex items-center justify-center text-xs font-bold leading-tight text-foreground group-hover:text-primary">
                                                                {film.title}
                                                            </p>
                                                            {(film.character || film.job) && (
                                                                <p className="mt-0.5 line-clamp-1 text-[11px] leading-tight text-muted-foreground/70">
                                                                    {film.character ? `as ${film.character}` : film.job}
                                                                </p>
                                                            )}
                                                        </div>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                ) : currentEntry?.kind === 'account' ? (
                    <div className="flex h-[92vh] sm:h-[88vh] flex-col overflow-hidden bg-background text-foreground">
                        <div className={cn('relative shrink-0 border-b border-border/40 px-4 py-4 sm:px-8 sm:py-5', isLight ? 'bg-muted/50 text-foreground' : 'bg-card text-white')}>
                            <button
                                type="button"
                                onClick={() => onOpenChange(false)}
                                aria-label="Close"
                                className={cn('absolute right-4 top-4 z-30 flex h-9 w-9 items-center justify-center rounded-full border shadow-lg backdrop-blur-md transition-all hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 active:scale-95', heroFrostedBtn)}
                            >
                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                                <span className="sr-only">Close</span>
                            </button>

                            {previousEntry && (
                                <button
                                    type="button"
                                    onClick={handleGoBack}
                                    className={cn('mb-3 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-bold backdrop-blur-md transition-all active:scale-95', heroGhostBtn)}
                                >
                                    <ArrowLeft className="h-4 w-4" />
                                    Back to {previousTitle}
                                </button>
                            )}

                            <div className="flex items-start gap-3 sm:gap-6">
                                <div className="h-20 w-20 shrink-0 sm:h-24 sm:w-24">
                                    {(() => {
                                        const acc = accounts.find(a => a.id === currentEntry.accountId)
                                        return acc
                                            ? <AccountAvatar account={acc} size="lg" className="!h-20 !w-20 sm:!h-24 sm:!w-24 rounded-full border-2 border-primary/60 shadow-2xl overflow-hidden" />
                                            : <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-primary/60 bg-muted sm:h-24 sm:w-24"><Users className="h-8 w-8 text-muted-foreground" /></div>
                                    })()}
                                </div>

                                <div className="flex-1 min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="rounded-md bg-primary/85 px-2 py-0.5 text-[11px] font-bold uppercase tracking-widest text-primary-foreground">
                                            Watch History
                                        </span>
                                    </div>
                                    <h2 className={cn('mt-1 text-xl font-extrabold sm:text-2xl tracking-tight sm:text-4xl', isLight ? 'text-foreground' : 'text-white')}>
                                        {currentEntry.accountName}
                                    </h2>
                                    <p className={cn('mt-1 text-xs', isLight ? 'text-muted-foreground/70' : 'text-white/60')}>
                                        {accountFilms ? `${accountFilms.count} ${accountFilms.count === 1 ? 'title' : 'titles'} watched` : 'Loading history...'}
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6 space-y-6 sm:space-y-8">
                            {!accountFilms || accountFilms.count === 0 ? (
                                <div className="flex h-64 flex-col items-center justify-center text-center">
                                    <Users className="h-10 w-10 text-muted-foreground/40 mb-2" />
                                    <p className="text-sm font-medium text-muted-foreground">No watch history found for this account.</p>
                                </div>
                            ) : (
                                <>
                                    {accountFilms.movies.length > 0 && (
                                        <div>
                                            <h3 className="mb-3.5 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground/80">
                                                <Film className="h-4 w-4 text-primary" />
                                                Movies ({accountFilms.movies.length})
                                            </h3>
                                            <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
                                                {accountFilms.movies.map(film => (
                                                    <button
                                                        type="button"
                                                        key={`acc-movie-${film.id}`}
                                                        onClick={() => handleSelectFilmFromFilmography({ id: film.id, title: film.title, poster: film.poster, type: film.type as 'movie' | 'series' | 'anime' })}
                                                        className="group flex flex-col items-center text-center focus:outline-none"
                                                    >
                                                        <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl bg-muted border border-border/40 shadow-sm transition-[transform,opacity,box-shadow] duration-200 group-hover:border-primary/50 group-hover:shadow-lg">
                                                            {film.poster ? (
                                                                <img src={film.poster} alt={film.title} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
                                                            ) : (
                                                                <div className="flex h-full w-full items-center justify-center p-3 text-center text-xs font-bold text-muted-foreground">
                                                                    {film.title}
                                                                </div>
                                                            )}
                                                            <WatcherBadges watchers={watchersByItemId.get(film.id) ?? []} />
                                                        </div>
                                                        <div className="mt-2 flex w-full flex-col items-center px-1 text-center">
                                                            <p className="line-clamp-2 min-h-[2.25rem] flex items-center justify-center text-xs font-bold leading-tight text-foreground group-hover:text-primary">
                                                                {film.title}
                                                            </p>
                                                        </div>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {accountFilms.series.length > 0 && (
                                        <div>
                                            <h3 className="mb-3.5 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground/80">
                                                <Clapperboard className="h-4 w-4 text-primary" />
                                                TV Series ({accountFilms.series.length})
                                            </h3>
                                            <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
                                                {accountFilms.series.map(film => (
                                                    <button
                                                        type="button"
                                                        key={`acc-series-${film.id}`}
                                                        onClick={() => handleSelectFilmFromFilmography({ id: film.id, title: film.title, poster: film.poster, type: film.type as 'movie' | 'series' | 'anime' })}
                                                        className="group flex flex-col items-center text-center focus:outline-none"
                                                    >
                                                        <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl bg-muted border border-border/40 shadow-sm transition-[transform,opacity,box-shadow] duration-200 group-hover:border-primary/50 group-hover:shadow-lg">
                                                            {film.poster ? (
                                                                <img src={film.poster} alt={film.title} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
                                                            ) : (
                                                                <div className="flex h-full w-full items-center justify-center p-3 text-center text-xs font-bold text-muted-foreground">
                                                                    {film.title}
                                                                </div>
                                                            )}
                                                            <WatcherBadges watchers={watchersByItemId.get(film.id) ?? []} />
                                                        </div>
                                                        <div className="mt-2 flex w-full flex-col items-center px-1 text-center">
                                                            <p className="line-clamp-2 min-h-[2.25rem] flex items-center justify-center text-xs font-bold leading-tight text-foreground group-hover:text-primary">
                                                                {film.title}
                                                            </p>
                                                        </div>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {accountFilms.anime.length > 0 && (
                                        <div>
                                            <h3 className="mb-3.5 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground/80">
                                                <Star className="h-4 w-4 text-amber-400" />
                                                Anime ({accountFilms.anime.length})
                                            </h3>
                                            <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
                                                {accountFilms.anime.map(film => (
                                                    <button
                                                        type="button"
                                                        key={`acc-anime-${film.id}`}
                                                        onClick={() => handleSelectFilmFromFilmography({ id: film.id, title: film.title, poster: film.poster, type: film.type as 'movie' | 'series' | 'anime' })}
                                                        className="group flex flex-col items-center text-center focus:outline-none"
                                                    >
                                                        <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl bg-muted border border-border/40 shadow-sm transition-[transform,opacity,box-shadow] duration-200 group-hover:border-primary/50 group-hover:shadow-lg">
                                                            {film.poster ? (
                                                                <img src={film.poster} alt={film.title} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
                                                            ) : (
                                                                <div className="flex h-full w-full items-center justify-center p-3 text-center text-xs font-bold text-muted-foreground">
                                                                    {film.title}
                                                                </div>
                                                            )}
                                                            <WatcherBadges watchers={watchersByItemId.get(film.id) ?? []} />
                                                        </div>
                                                        <div className="mt-2 flex w-full flex-col items-center px-1 text-center">
                                                            <p className="line-clamp-2 min-h-[2.25rem] flex items-center justify-center text-xs font-bold leading-tight text-foreground group-hover:text-primary">
                                                                {film.title}
                                                            </p>
                                                        </div>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                ) : (
                    /* ══ MOVIE DETAIL VIEW ══════════════════════════════════════════ */
                    <>
                        <div className="relative w-full shrink-0 overflow-hidden bg-black text-white -mb-1" style={{ height: 'clamp(220px, 38vh, 380px)', transform: 'translateZ(0)' }}>
                            <div className="absolute inset-0 bg-black" aria-hidden="true" />
                            {background && (
                                <img
                                    src={background}
                                    alt=""
                                    aria-hidden="true"
                                    className="absolute inset-0 h-full w-full object-cover filter blur-3xl opacity-40 scale-125"
                                />
                            )}

                            {loading && !background ? (
                                <Skeleton className="absolute inset-0 h-full w-full rounded-none" />
                            ) : background ? (
                                <img
                                    src={background}
                                    alt=""
                                    aria-hidden="true"
                                    loading="eager"
                                    decoding="async"
                                    className="absolute inset-0 h-full w-full object-cover opacity-95 transition-opacity duration-300"
                                    style={{
                                        maskImage: 'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0.9) 70%, rgba(0,0,0,0) 100%)',
                                        WebkitMaskImage: 'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0.9) 70%, rgba(0,0,0,0) 100%)',
                                    }}
                                />
                            ) : (
                                <div className="absolute inset-0 bg-black/90" />
                            )}

                            <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/50 via-black/15 to-transparent" />
                            <div className="pointer-events-none absolute inset-y-0 left-0 w-3/5 bg-gradient-to-r from-black/60 via-black/20 to-transparent" />

                            {/* Adaptive Back Button — top-left frosted glass */}
                            {previousEntry && (
                                <button
                                    type="button"
                                    onClick={handleGoBack}
                                    className="absolute left-2 top-2 sm:left-3 sm:top-3 z-30 inline-flex items-center gap-2 rounded-full border border-white/20 bg-black/60 px-3 py-1 sm:px-4 sm:py-1.5 text-xs font-bold text-white shadow-xl backdrop-blur-md transition-all hover:bg-black/80 hover:scale-105 active:scale-95"
                                >
                                    <ArrowLeft className="h-4 w-4" />
                                    Back to {previousTitle}
                                </button>
                            )}

                            {/* Close button — top-right, frosted glass */}
                            <button
                                type="button"
                                onClick={() => onOpenChange(false)}
                                aria-label="Close"
                                className="absolute right-3 top-3 z-30 flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/50 text-white/90 shadow-lg backdrop-blur-sm transition-all hover:bg-black/75 hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                            >
                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                                <span className="sr-only">Close</span>
                            </button>
                        </div>

                        {/* ══ POSTER + TITLE ROW (overlaps hero) ═══════════════════ */}
                        <div className="relative z-10 -mt-16 shrink-0 px-4 sm:px-8">
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-6">

                                {/* Poster — taller on desktop */}
                                <div className="relative hidden aspect-[2/3] w-24 sm:block sm:w-32 shrink-0 overflow-hidden rounded-xl shadow-2xl ring-1 ring-white/10 sm:w-40 sm:rounded-2xl">
                                    {loading ? (
                                        <Skeleton className="h-full w-full rounded-none" />
                                    ) : (
                                        <Poster
                                            src={posterSrc}
                                            itemId={renderItem.itemId}
                                            itemType={renderItem.type}
                                            alt={title}
                                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                                            loading="eager"
                                        />
                                    )}
                                </div>

                                {/* Title + meta block */}
                                <div className="min-w-0 flex-1 pb-1 sm:pb-2">
                                    {loading ? (
                                        <div className="space-y-2.5">
                                            <Skeleton className="h-8 w-3/4 rounded-lg" />
                                            <Skeleton className="h-4 w-1/2 rounded-lg" />
                                            <Skeleton className="h-4 w-1/3 rounded-lg" />
                                        </div>
                                    ) : (
                                        <>

                                            {/* Title — HD logo if available, text fallback */}
                                            <div className="flex h-16 items-end sm:h-24">
                                                {meta?.logo ? (
                                                    <img
                                                        src={meta.logo}
                                                        alt={title}
                                                        className="max-h-16 w-auto max-w-[90%] object-contain drop-shadow-lg sm:max-h-24"
                                                    />
                                                ) : (
                                                    <h2 className="text-xl font-extrabold sm:text-2xl leading-tight tracking-tight text-white drop-shadow-sm sm:text-4xl">
                                                        {title}
                                                    </h2>
                                                )}
                                            </div>

                                            {/* Meta pills row */}
                                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                                {year && (
                                                    <span className={cn('inline-flex items-center gap-1 text-sm font-medium', isLight ? 'text-muted-foreground' : 'text-white/80')}>
                                                        <Calendar className="h-3.5 w-3.5" />
                                                        {year}
                                                    </span>
                                                )}
                                                {runtime && (
                                                    <>
                                                        <span className={isLight ? 'text-border' : 'text-white/30'}>.</span>
                                                        <span className={cn('inline-flex items-center gap-1 text-sm font-medium', isLight ? 'text-muted-foreground' : 'text-white/80')}>
                                                            <Clock className="h-3.5 w-3.5" />
                                                            {formatRuntime(runtime)}
                                                        </span>
                                                    </>
                                                )}
                                                {meta?.certification && (
                                                    <span className={cn('ml-1 rounded-md border px-2 py-0.5 font-mono text-[11px] font-bold shadow-sm backdrop-blur-md', isLight ? 'border-border/40 bg-muted/40 text-foreground' : 'border-white/20 bg-white/10 text-white')}>
                                                        {meta.certification}
                                                    </span>
                                                )}
                                            </div>

                                            {/* Rating row — Platform Branded Badges */}
                                            {allRatings.length > 0 && (
                                                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                                                    {allRatings.map((r, idx) => (
                                                        <Tooltip key={`${r.source}-${idx}`} content={RATING_LABELS[r.source] || `${r.source} Rating`}>
                                                            <RatingBadge rating={r} />
                                                        </Tooltip>
                                                    ))}
                                                </div>
                                            )}

                                            {/* Action buttons row — Authentic Apple TV Action Pills */}
                                            <div className="mt-4 flex flex-row flex-wrap items-center gap-2 sm:gap-3">
                                                {isStremioFriendlyType(normalizedType) && (
                                                    <button
                                                        type="button"
                                                        className={cn('inline-flex h-11 flex-1 justify-center items-center gap-2.5 rounded-full px-7 text-sm font-bold shadow-xl transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 sm:flex-none sm:w-auto sm:justify-start', heroPrimaryBtn)}
                                                        onClick={() => openStremioDetail(renderItem.type, renderItem.itemId)}
                                                    >
                                                        <Play className="h-4 w-4 fill-current" />
                                                        Play
                                                    </button>
                                                )}
                                                <WatchlistPicker
                                                    accounts={accounts}
                                                    watchlistTargets={watchlistTargets}
                                                    onToggle={handleToggleWatchlistTarget}
                                                    loading={watchlistLoading}
                                                />
                                            </div>
                                        </>
                                    )}
                                </div>

                                {otherWatchers.length > 0 && (
                                    <div className="flex w-full items-center gap-2 pt-2 sm:w-auto sm:shrink-0 sm:flex-col sm:items-end sm:gap-2 sm:pb-2">
                                        <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/80 flex items-center gap-1.5">
                                            <Users className="h-3.5 w-3.5" /> Also watched
                                        </span>
                                        <div className="flex items-center -space-x-2">
                                            {otherWatchers.slice(0, 8).map(({ id }) => {
                                                const acc = accounts.find(a => a.id === id)
                                                if (!acc) return null
                                                const maskedName = maskedDisplayName(acc.name, acc.email, isPrivacyModeEnabled ? privacyLevelNames : 0)
                                                return (
                                                    <Tooltip key={id} content={maskedName}>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleAccountClick(id, acc.name)}
                                                            className="relative flex h-9 w-9 items-center justify-center rounded-full border-2 border-background bg-card overflow-hidden transition-transform hover:scale-110 hover:z-10"
                                                        >
                                                            <AccountAvatar
                                                                account={{ ...acc, name: maskedName }}
                                                                size="md"
                                                                showStatus={false}
                                                                className="!h-full !w-full rounded-full"
                                                            />
                                                        </button>
                                                    </Tooltip>
                                                )
                                            })}
                                        </div>
                                        {otherWatchers.length > 8 && <span className="text-[11px] text-muted-foreground">+{otherWatchers.length - 8}</span>}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* ══ SCROLLABLE BODY ════════════════════════════════════════ */}
                        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-8">
                            <div className="space-y-6">

                                {/* Loading skeletons */}
                                {loading && (
                                    <div className="space-y-2.5">
                                        <Skeleton className="h-3 w-full rounded" />
                                        <Skeleton className="h-3 w-11/12 rounded" />
                                        <Skeleton className="h-3 w-9/12 rounded" />
                                        <div className="flex flex-wrap gap-1.5 pt-1">
                                            <Skeleton className="h-6 w-16 rounded-full" />
                                            <Skeleton className="h-6 w-20 rounded-full" />
                                            <Skeleton className="h-6 w-14 rounded-full" />
                                        </div>
                                    </div>
                                )}

                                {/* Metadata unavailable notice */}
                                {failed && !loading && !meta && (
                                    <div className="rounded-xl border border-warning/25 bg-warning/10 px-3 py-2.5 text-xs text-warning">
                                        Detailed metadata unavailable. Showing basic info.
                                    </div>
                                )}

                                {/* Description - series-level, spoiler-free */}
                                {!loading && description && (
                                    <div className="space-y-1.5">
                                        {renderItem.season !== undefined && renderItem.episode !== undefined && (
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
                                                Series Overview
                                            </p>
                                        )}
                                        <p className={cn(
                                            'text-sm leading-relaxed text-muted-foreground sm:text-base',
                                            !descExpanded && 'line-clamp-3 sm:line-clamp-4',
                                        )}>
                                            {description}
                                        </p>
                                        {canCollapse && (
                                            <button
                                                type="button"
                                                className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                                                onClick={() => setDescExpanded(v => !v)}
                                            >
                                                {descExpanded
                                                    ? <><ChevronUp className="h-3 w-3" />Show less</>
                                                    : <><ChevronDown className="h-3 w-3" />Show more</>
                                                }
                                            </button>
                                        )}
                                    </div>
                                )}

                                {/* Genre pills */}
                                {!loading && genres.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5">
                                        {genres.map(g => (
                                            <span
                                                key={g}
                                                className="rounded-full border border-border/50 bg-muted/40 px-2.5 py-0.5 text-xs font-medium text-foreground/70"
                                            >
                                                {g}
                                            </span>
                                        ))}
                                    </div>
                                )}

                                {/* ── SEASON / EPISODE BROWSER ─────────────────────────────────── */}
                                <SeasonBrowser
                                    seriesTmdbId={seriesTmdbId}
                                    activeItem={activeItem}
                                    isLight={isLight}
                                    loading={loading}
                                />

                                {/* ── WHERE TO WATCH ───────────────────────────────────── */}
                                {!loading && meta?.watchProviders && meta.watchProviders.length > 0 && (
                                    <div>
                                        <h3 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground/80">
                                            <Play className="h-3.5 w-3.5 text-primary" />
                                            Where to Watch
                                        </h3>
                                        <div className="flex flex-wrap gap-2">
                                            {meta.watchProviders.map((p, i) => (
                                                <div key={i} className="flex items-center gap-1.5 rounded-lg border border-border/40 bg-muted/30 px-2.5 py-1.5">
                                                    {p.logo && (
                                                        <img src={p.logo} alt="" className="h-5 w-5 rounded object-cover" loading="lazy" />
                                                    )}
                                                    <span className="text-xs font-semibold text-foreground/80">{p.name}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* ── BACKDROP GALLERY ──────────────────────────────────── */}
                                {!loading && meta?.galleryBackdrops && meta.galleryBackdrops.length > 0 && (
                                    <div>
                                        <div className="mb-2 flex items-center justify-between">
                                            <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground/80">
                                                <Film className="h-3.5 w-3.5 text-primary" />
                                                Gallery
                                            </h3>
                                            <div className="flex items-center gap-1">
                                                <button
                                                    type="button"
                                                    onClick={() => scrollGalleryRef.current?.scrollBy({ left: -320, behavior: 'smooth' })}
                                                    aria-label="Scroll gallery left"
                                                    className="flex h-7 w-7 items-center justify-center rounded-full border border-border/40 bg-muted/60 text-muted-foreground shadow-sm transition-all hover:bg-accent hover:text-foreground active:scale-95"
                                                >
                                                    <ChevronLeft className="h-4 w-4" />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => scrollGalleryRef.current?.scrollBy({ left: 320, behavior: 'smooth' })}
                                                    aria-label="Scroll gallery right"
                                                    className="flex h-7 w-7 items-center justify-center rounded-full border border-border/40 bg-muted/60 text-muted-foreground shadow-sm transition-all hover:bg-accent hover:text-foreground active:scale-95"
                                                >
                                                    <ChevronRight className="h-4 w-4" />
                                                </button>
                                            </div>
                                        </div>
                                        <div ref={scrollGalleryRef} className="scrollbar-hide -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 scroll-smooth">
                                            {meta.galleryBackdrops.map((img, i) => (
                                                <button
                                                    key={i}
                                                    type="button"
                                                    onClick={() => { setLightboxIndex(i); setLightboxZoom(false) }}
                                                    className="group relative aspect-video w-48 shrink-0 overflow-hidden rounded-lg border border-border/30 bg-muted shadow-sm transition-all hover:border-border/60 hover:shadow-md sm:w-64"
                                                >
                                                    <img src={img} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                                                    <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/20 group-hover:opacity-100">
                                                        <span className="rounded-full bg-black/60 px-2 py-1 text-[10px] font-bold text-white backdrop-blur-sm">Expand</span>
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {!loading && (cast.length > 0 || crew.length > 0) && (
                                    <CastSection
                                        cast={cast}
                                        crew={crew}
                                        isLight={isLight}
                                        onPersonClick={handlePersonClick}
                                    />
                                )}

                                {/* ── TRAILER ────────────────────────────────────────── */}
                                {!loading && trailer && (
                                    <div id="modal-trailer-section" ref={trailerSectionRef}>
                                        <div className="mb-2.5 flex items-center justify-between">
                                            <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground/80">
                                                <Film className="h-3.5 w-3.5 text-primary" />
                                                Trailer
                                                {trailer.source === 'tmdb' && (
                                                    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-primary">
                                                        TMDB
                                                    </span>
                                                )}
                                            </h3>
                                            {meta?.videoList && meta.videoList.length > 1 && (
                                                <button
                                                    type="button"
                                                    onClick={handleNextTrailer}
                                                    className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-muted/40 px-3 py-1 text-xs font-bold text-muted-foreground transition-all hover:bg-primary/10 hover:text-primary active:scale-95"
                                                >
                                                    <Film className="h-3 w-3" />
                                                    Try Next Video
                                                </button>
                                            )}
                                        </div>
                                        <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-border/40 bg-black shadow-xl">
                                            <Tooltip content={`${title} trailer`}>
                                                <iframe
                                                    src={`https://www.youtube.com/embed/${trailer.youTubeId}?enablejsapi=1`}
                                                    className="absolute inset-0 h-full w-full"
                                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                                    allowFullScreen
                                                    loading="lazy"
                                                    referrerPolicy="strict-origin-when-cross-origin"
                                                    sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
                                                />
                                            </Tooltip>
                                        </div>
                                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                                            <span className="truncate max-w-sm text-muted-foreground/70">
                                                Having trouble? Private or unavailable videos can be searched directly on YouTube.
                                            </span>
                                            <div className="flex items-center gap-2 shrink-0">
                                                {meta?.videoList && meta.videoList.length > 1 && (
                                                    <button
                                                        type="button"
                                                        onClick={handleNextTrailer}
                                                        className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline"
                                                    >
                                                        ⏭ Switch Clip
                                                    </button>
                                                )}
                                                <a
                                                    href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`${title} ${year || ''} trailer`)}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline"
                                                >
                                                    <ExternalLink className="h-3 w-3" />
                                                    Search YouTube
                                                </a>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* No trailer */}
                                {!loading && !trailer && (
                                    <div className="flex items-center gap-3 rounded-xl border border-dashed border-border/50 bg-muted/20 px-4 py-3">
                                        <Film className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                                        <span className="text-xs text-muted-foreground">No trailer found.</span>
                                        <a
                                            href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`${title} ${year} trailer`)}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="ml-auto inline-flex items-center gap-1 rounded-lg border border-border/40 bg-background/60 px-2.5 py-1 text-[11px] font-medium text-primary transition-colors hover:border-primary/30 hover:bg-primary/10"
                                        >
                                            <ExternalLink className="h-3 w-3" />
                                            Search YouTube
                                        </a>
                                    </div>
                                )}

                                {/* ── TRAILERS & EXTRA CLIPS CAROUSEL ─────────────────── */}
                                {!loading && meta?.videoList && meta.videoList.length > 1 && (
                                    <div className="mt-6">
                                        <div className="mb-3 flex items-center justify-between">
                                            <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground/80">
                                                <Film className="h-3.5 w-3.5 text-primary" />
                                                Trailers & Extra Clips ({meta.videoList.length})
                                            </h3>
                                            <div className="flex items-center gap-1">
                                                <button
                                                    type="button"
                                                    onClick={() => scrollTrailersRef.current?.scrollBy({ left: -320, behavior: 'smooth' })}
                                                    className="flex h-7 w-7 items-center justify-center rounded-full border border-border/40 bg-muted/60 text-muted-foreground hover:text-foreground"
                                                >
                                                    <ChevronLeft className="h-4 w-4" />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => scrollTrailersRef.current?.scrollBy({ left: 320, behavior: 'smooth' })}
                                                    className="flex h-7 w-7 items-center justify-center rounded-full border border-border/40 bg-muted/60 text-muted-foreground hover:text-foreground"
                                                >
                                                    <ChevronRight className="h-4 w-4" />
                                                </button>
                                            </div>
                                        </div>

                                        <div ref={scrollTrailersRef} className="scrollbar-hide -mx-1 flex gap-4 overflow-x-auto px-1 pb-1 scroll-smooth">
                                            {meta.videoList.map((vid, idx) => (
                                                <button
                                                    type="button"
                                                    key={`vid-${vid.key}-${idx}`}
                                                    onClick={() => {
                                                        setTrailer({ youTubeId: vid.key, source: 'tmdb' })
                                                        trailerSectionRef.current?.scrollIntoView({ behavior: 'smooth' })
                                                    }}
                                                    className="group relative flex w-56 shrink-0 flex-col gap-2 rounded-2xl border border-border/40 bg-card/60 p-2.5 shadow-md transition-all hover:border-primary/50 hover:shadow-xl text-left"
                                                >
                                                    <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-muted">
                                                        <img
                                                            src={`https://img.youtube.com/vi/${vid.key}/mqdefault.jpg`}
                                                            alt={vid.name}
                                                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                                                            loading="lazy"
                                                        />
                                                        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-80 group-hover:opacity-100 transition-opacity">
                                                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg">
                                                                <Play className="h-4 w-4 fill-current ml-0.5" />
                                                            </div>
                                                        </div>
                                                        <span className="absolute bottom-2 left-2 rounded-md bg-black/80 px-2 py-0.5 text-[10px] font-extrabold uppercase text-white backdrop-blur-md">
                                                            {vid.type}
                                                        </span>
                                                    </div>
                                                    <Tooltip content={vid.name}>
                                                        <p className="line-clamp-1 text-xs font-bold text-foreground group-hover:text-primary">
                                                            {vid.name}
                                                        </p>
                                                    </Tooltip>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* ── CONTENT-AWARE MORE LIKE THIS CAROUSEL ─────────────── */}
                                {!loading && meta?.relatedList && meta.relatedList.length > 0 && (
                                    <div className="mt-6">
                                        <div className="mb-3 flex items-center justify-between">
                                            <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground/80">
                                                <Sparkles className="h-3.5 w-3.5 text-primary" />
                                                More Like This ({meta.relatedList.length})
                                            </h3>
                                            <div className="flex items-center gap-1">
                                                <button
                                                    type="button"
                                                    onClick={() => scrollRelatedRef.current?.scrollBy({ left: -320, behavior: 'smooth' })}
                                                    className="flex h-7 w-7 items-center justify-center rounded-full border border-border/40 bg-muted/60 text-muted-foreground hover:text-foreground"
                                                >
                                                    <ChevronLeft className="h-4 w-4" />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => scrollRelatedRef.current?.scrollBy({ left: 320, behavior: 'smooth' })}
                                                    className="flex h-7 w-7 items-center justify-center rounded-full border border-border/40 bg-muted/60 text-muted-foreground hover:text-foreground"
                                                >
                                                    <ChevronRight className="h-4 w-4" />
                                                </button>
                                            </div>
                                        </div>

                                        <div ref={scrollRelatedRef} className="scrollbar-hide -mx-1 flex gap-4 overflow-x-auto px-1 pb-1 scroll-smooth">
                                            {meta.relatedList.map((rel, idx) => (
                                                <button
                                                    type="button"
                                                    key={`rel-${rel.id}-${idx}`}
                                                    onClick={() => {
                                                        const newItem: DetailItem = {
                                                            itemId: rel.id.startsWith('tmdb:') ? rel.id : `tmdb:${rel.id}`,
                                                            type: rel.type,
                                                            name: rel.title,
                                                            poster: rel.poster,
                                                            year: rel.year ? Number(rel.year) : undefined,
                                                            voteAverage: rel.voteAverage,
                                                        }
                                                        setActiveItem(newItem)
                                                        setNavStack(prev => [...prev, { kind: 'item', item: newItem }])
                                                    }}
                                                    className="group flex w-32 shrink-0 flex-col items-center text-center focus:outline-none sm:w-36"
                                                >
                                                    <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl bg-muted border border-border/40 shadow-sm transition-[transform,opacity,box-shadow] duration-200 group-hover:border-primary/50 group-hover:shadow-lg">
                                                        {rel.poster ? (
                                                            <img
                                                                src={rel.poster}
                                                                alt={rel.title}
                                                                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                                                                loading="lazy"
                                                            />
                                                        ) : (
                                                            <div className="flex h-full w-full items-center justify-center p-3 text-center text-xs font-bold text-muted-foreground">
                                                                {rel.title}
                                                            </div>
                                                        )}
                                                        {rel.year && (
                                                            <span className="absolute right-2 top-2 rounded-md bg-black/80 px-1.5 py-0.5 text-[10px] font-bold text-white shadow backdrop-blur-sm">
                                                                {rel.year}
                                                            </span>
                                                        )}
                                                        <WatcherBadges watchers={watchersByItemId.get(rel.id.startsWith('tmdb:') ? rel.id : `tmdb:${rel.id}`) ?? []} />
                                                    </div>
                                                    <p className="mt-2 line-clamp-2 text-xs font-bold leading-tight text-foreground group-hover:text-primary">
                                                        {rel.title}
                                                    </p>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* ── AUDIENCE REVIEWS & DISCUSSIONS ─────────────────── */}
                                {!loading && <ReviewsSection reviews={meta?.reviewsList ?? []} />}

                                {/* ── PRODUCTION & NETWORK INFO PILLS ───────────────── */}
                                {!loading && (meta?.status || meta?.originalLanguage || (meta?.productionCompanies && meta.productionCompanies.length > 0) || (meta?.networks && meta.networks.length > 0) || meta?.collection) && (
                                    <div className="mt-6 flex flex-wrap items-center gap-2 pt-4 border-t border-border/40">
                                        {meta.collection && (
                                            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                                                <Layers className="h-3 w-3" />
                                                {meta.collection.name}
                                            </span>
                                        )}
                                        {meta.status && (
                                            <span className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
                                                Status: {meta.status}
                                            </span>
                                        )}
                                        {meta.originalLanguage && (
                                            <span className="rounded-full border border-border/50 bg-muted/40 px-3 py-1 text-xs font-bold text-muted-foreground flex items-center gap-1.5">
                                                <Languages className="h-3 w-3 text-primary" />
                                                Language: {meta.originalLanguage}
                                            </span>
                                        )}
                                        {meta.networks && meta.networks.length > 0 && (
                                            <span className="rounded-full border border-border/50 bg-muted/40 px-3 py-1 text-xs font-bold text-muted-foreground flex items-center gap-1.5">
                                                <Tv className="h-3 w-3 text-primary" />
                                                Network: {meta.networks.join(', ')}
                                            </span>
                                        )}
                                        {meta.productionCompanies && meta.productionCompanies.length > 0 && (
                                            <span className="rounded-full border border-border/50 bg-muted/40 px-3 py-1 text-xs font-bold text-muted-foreground flex items-center gap-1.5">
                                                <Building2 className="h-3 w-3 text-primary" />
                                                Studio: {meta.productionCompanies.slice(0, 2).join(', ')}
                                            </span>
                                        )}
                                    </div>
                                )}

                                <div className="h-2" />

                                {dataSources.length > 0 && (
                                    <div className="flex flex-wrap items-center gap-1.5 py-1">
                                        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/40">Data from</span>
                                        {dataSources.map(src => (
                                            <span key={src} className="rounded bg-muted/40 px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground/60">
                                                {src}
                                            </span>
                                        ))}
                                    </div>
                                )}

                                <div className="h-2" />
                            </div>
                        </div>
                    </>
                )}
            </DialogContent>

            <LightboxViewer
                images={meta?.galleryBackdrops ?? []}
                index={lightboxIndex}
                zoom={lightboxZoom}
                onClose={() => { setLightboxIndex(null); setLightboxZoom(false) }}
                onNavigate={(i) => { setLightboxIndex(i); setLightboxZoom(false) }}
                onToggleZoom={() => setLightboxZoom(z => !z)}
            />
        </Dialog>
    )
}
