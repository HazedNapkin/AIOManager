import { getPlatformEntry } from '@/lib/platform-registry'
import { cn } from '@/lib/utils'
import { Tooltip } from '@/components/ui/tooltip'

export function PlatformSourceBadge({ source, className, label, mediaSources = [] }: { source?: string; className?: string; label?: string; mediaSources?: string[] }) {
    const entry = source ? getPlatformEntry(source) : undefined
    const media = getPlatformEntry('jellyfin')
    if (!entry) return null

    return (
        <Tooltip content={`From ${[label || entry.name, ...mediaSources].filter((value, i, all) => all.indexOf(value) === i).join(', ')}`}>
            <div
                className={cn(
                    'absolute top-1.5 left-1.5 z-20 flex h-5 w-fit min-w-5 items-center justify-center overflow-hidden rounded-md bg-background/85 ring-1 ring-black/20 shadow-sm backdrop-blur-sm',
                    className
                )}
            >
                <img src={entry.logo} alt={label || entry.name} className="h-5 w-5 object-contain p-0.5" loading="lazy" />
                {source !== 'jellyfin' && mediaSources.length > 0 && media && <img src={media.logo} alt={mediaSources.join(', ')} className="h-5 w-5 object-contain p-0.5" loading="lazy" />}
            </div>
        </Tooltip>
    )
}
