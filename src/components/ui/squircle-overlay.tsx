interface SquircleOverlayProps {
    background?: string
    className?: string
}

export function SquircleOverlay({ background = 'hsl(var(--muted))', className }: SquircleOverlayProps) {
    return (
        <div
            className={className ?? 'absolute inset-0'}
            style={{ background, filter: 'url(#squircle)' }}
        />
    )
}
