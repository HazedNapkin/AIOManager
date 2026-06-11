import { useState } from 'react'
import { cn } from '@/lib/utils'

// Addon logos are arbitrary remote URLs that frequently 404. When the image fails
// we fall back to the first letter of the name instead of leaving an empty tile.
export function AddonLogo({
  src,
  name,
  className,
  letterClassName = 'text-sm',
}: {
  src?: string | null
  name: string
  className?: string
  letterClassName?: string
}) {
  const [failed, setFailed] = useState(false)
  const showImage = !!src && !failed
  return (
    <div className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/40 bg-muted/40', className)}>
      {showImage ? (
        <img src={src!} alt="" loading="lazy" className="h-full w-full object-contain" onError={() => setFailed(true)} />
      ) : (
        <span className={cn('font-bold text-muted-foreground', letterClassName)}>{(name.charAt(0) || '?').toUpperCase()}</span>
      )}
    </div>
  )
}
