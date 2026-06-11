import { cn } from '@/lib/utils'

interface BorderBeamProps {
  className?: string
  duration?: number
  borderWidth?: number
  colorFrom?: string
  colorTo?: string
  delay?: number
}

export function BorderBeam({
  className,
  duration = 15,
  borderWidth = 1.5,
  colorFrom = 'hsl(var(--primary))',
  colorTo = 'transparent',
  delay = 0,
}: BorderBeamProps) {
  return (
    <span
      aria-hidden
      className={cn('pointer-events-none absolute inset-0 rounded-[inherit]', className)}
      style={{
        padding: `${borderWidth}px`,
        WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
        WebkitMaskComposite: 'xor',
        maskComposite: 'exclude',
      }}
    >
      <span
        className="absolute block animate-spin"
        style={{
          inset: '-150%',
          background: `conic-gradient(from 0deg, transparent 340deg, ${colorFrom} 355deg, ${colorTo} 360deg)`,
          animationDuration: `${duration}s`,
          animationTimingFunction: 'linear',
          animationDelay: `-${delay}s`,
        }}
      />
    </span>
  )
}
