import { memo, useState, useEffect, useRef } from 'react'
import { User, Clapperboard, ChevronLeft, ChevronRight } from 'lucide-react'
import { Tooltip } from '@/components/ui/tooltip'
import { CastInitials } from '@/components/activity/detail/CastInitials'
import { ensurePhotoStoreLoaded, resolvePersonPhoto, debouncedPersist, getCastPhotoUrl } from '@/components/activity/detail/cast-photo-utils'

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

export type CastSectionPerson = { name: string; character?: string; photo?: string }
export type CastSectionCrew = { name: string; role?: string; photo?: string }

export const CastSection = memo(function CastSection({
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
