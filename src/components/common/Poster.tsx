import { useState, useEffect, useMemo } from 'react'
import { Film, Tv } from 'lucide-react'
import { cn, sanitizePosterUrl } from '@/lib/utils'
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
    const [attempt, setAttempt] = useState(0)

    const sources = useMemo(() => {
        const cleanSrc = sanitizePosterUrl(src)
        const effectiveSrc = typeof cleanSrc === 'string' && cleanSrc.trim() ? cleanSrc : undefined
        const cinemetaItemId = getCinemetaItemId(itemId)
        const cinemetaSrc = fallback && cinemetaItemId ? proxyUrl(getCinemetaPosterUrl(cinemetaItemId)) : undefined
        const extractedFallbacks: string[] = []
        let hasEmbeddedFallback = false
        if (typeof effectiveSrc === 'string') {
            try {
                const parsed = new URL(effectiveSrc)
                for (const key of ['fallback', 'url']) {
                    const val = parsed.searchParams.get(key)
                    if (val && val.startsWith('http')) {
                        hasEmbeddedFallback = true
                        const proxied = proxyUrl(val)
                        if (proxied) extractedFallbacks.push(proxied)
                    }
                }
            } catch {}
        }
        const providedSrc = (!hasEmbeddedFallback && typeof effectiveSrc === 'string') ? proxyUrl(effectiveSrc) : undefined
        return [...extractedFallbacks, providedSrc, cinemetaSrc].filter(
            (url, index, arr): url is string => Boolean(url) && arr.indexOf(url) === index
        )
    }, [src, itemId, fallback])

    useEffect(() => { setAttempt(0) }, [sources])

    const currentSrc = sources[attempt]

    const handleError = () => {
        setAttempt(attempt + 1)
    }

    if (!currentSrc) {
        return (
            <div className={cn(
                "w-full h-full flex items-center justify-center bg-muted/40 transition-[transform,opacity,box-shadow]",
                className
            )}>
                <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 p-2">
                    {_itemType === 'series' ? (
                        <Tv className="h-6 w-6 text-muted-foreground/30" />
                    ) : (
                        <Film className="h-6 w-6 text-muted-foreground/30" />
                    )}
                    {props.alt && (
                        <span className="line-clamp-2 text-center text-[10px] font-medium text-muted-foreground/50">{props.alt}</span>
                    )}
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
