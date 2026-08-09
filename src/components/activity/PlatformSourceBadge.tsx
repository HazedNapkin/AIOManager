import { getPlatformEntry } from '@/lib/platform-registry'
import { cn } from '@/lib/utils'
import { Tooltip } from '@/components/ui/tooltip'

export function PlatformSourceBadge({ source, className }: { source?: string; className?: string }) {
    const entry = source ? getPlatformEntry(source) : undefined
    if (!entry) return null

    return (
        <Tooltip content={`From ${entry.name}`}>
            <div
                className={cn(
                    'absolute top-1.5 left-1.5 z-20 flex h-5 w-5 items-center justify-center overflow-hidden rounded-md bg-background/85 ring-1 ring-black/20 shadow-sm backdrop-blur-sm',
                    className
                )}
            >
                <img src={entry.logo} alt={entry.name} className="h-full w-full object-contain p-0.5" loading="lazy" />
            </div>
        </Tooltip>
    )
}