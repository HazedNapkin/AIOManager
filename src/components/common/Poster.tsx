import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { isProxyableUrl, getCinemetaPosterUrl } from '@/lib/cinemeta-utils'

interface PosterProps extends React.ImgHTMLAttributes<HTMLImageElement> {
    itemId?: string
    itemType?: string
    fallback?: boolean
}

function proxyUrl(url: string | undefined): string | undefined {
    if (!url) return undefined
    if (isProxyableUrl(url) && !url.startsWith('/api/proxy-image')) {
        return `/api/proxy-image?url=${encodeURIComponent(url)}`
    }
    return url
}

function getCinemetaItemId(itemId: string | undefined): string | undefined {
    return itemId?.match(/tt\d+/i)?.[0]
}

export function Poster({
    src,
    itemId,
    itemType: _itemType,
    className,
    fallback = true,
    ...props
}: PosterProps) {
    const [currentSrc, setCurrentSrc] = useState<string | undefined>()
    const [hasError, setHasError] = useState(false)
    const [attempt, setAttempt] = useState(0)
    const [sources, setSources] = useState<string[]>([])

    useEffect(() => {
        setHasError(false)
        setAttempt(0)
        const cinemetaItemId = getCinemetaItemId(itemId)
        const cinemetaSrc = fallback && cinemetaItemId ? proxyUrl(getCinemetaPosterUrl(cinemetaItemId)) : undefined
        const providedSrc = typeof src === 'string' ? proxyUrl(src) : undefined
        const nextSources = [cinemetaSrc, providedSrc].filter(
            (url, index, arr): url is string => Boolean(url) && arr.indexOf(url) === index
        )

        setSources(nextSources)
        setCurrentSrc(nextSources[0])
    }, [src, itemId, fallback])

    const handleError = () => {
        const nextAttempt = attempt + 1
        if (nextAttempt < sources.length) {
            setAttempt(nextAttempt)
            setCurrentSrc(sources[nextAttempt])
            return
        }

        if (attempt < sources.length) {
            setAttempt(sources.length)
            setHasError(true)
        }
    }

    if (hasError || !currentSrc) {
        return (
            <div className={cn(
                "w-full h-full bg-muted flex items-center justify-center text-muted-foreground transition-[transform,opacity,box-shadow]",
                className
            )}>
                <div className="flex flex-col items-center gap-1 opacity-20">
                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span className="text-xs font-bold uppercase tracking-tight">No Image</span>
                </div>
            </div>
        )
    }

    return (
        <img
            loading="lazy"
            decoding="async"
            src={currentSrc}
            className={cn("w-full h-full object-cover", className)}
            onError={handleError}
            {...props}
        />
    )
}
