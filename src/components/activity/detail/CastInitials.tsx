import { memo } from 'react'

export const CastInitials = memo(function CastInitials({ name }: { name: string }) {
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
