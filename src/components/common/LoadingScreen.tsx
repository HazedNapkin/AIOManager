import { useEffect, useState } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { cn } from '@/lib/utils'

const BOOT_STEPS = [
  'Decrypting vault',
  'Loading accounts',
  'Checking sync status',
  'Preparing workspace',
]

interface AppLoaderProps {
  variant?: 'boot' | 'route' | 'inline'
  label?: string
  steps?: string[]
  className?: string
}

export function AppLoader({
  variant = 'route',
  label = 'Loading workspace',
  steps = BOOT_STEPS,
  className,
}: AppLoaderProps) {
  const { isLight } = useTheme()
  const [activeStep, setActiveStep] = useState(0)

  useEffect(() => {
    if (variant !== 'boot' || steps.length <= 1) return

    const interval = window.setInterval(() => {
      setActiveStep((step) => Math.min(step + 1, steps.length - 1))
    }, 900)

    return () => window.clearInterval(interval)
  }, [steps.length, variant])

  if (variant === 'inline') {
    return (
      <div className={cn('inline-flex items-center gap-2 text-xs text-muted-foreground', className)} role="status">
        <span className="relative flex h-2 w-2" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/50" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
        </span>
        <span>{label}</span>
      </div>
    )
  }

  if (variant === 'route') {
    return (
      <div className={cn('min-h-screen bg-background flex items-center justify-center p-6', className)} role="status">
        <div className="flex items-center gap-3 rounded-full border border-border/60 bg-card px-4 py-2 shadow-sm">
          <span className="h-2 w-2 rounded-full bg-primary animate-pulse" aria-hidden="true" />
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
        </div>
      </div>
    )
  }

  const progress = Math.round(((activeStep + 1) / Math.max(steps.length, 1)) * 100)

  return (
    <div className={cn('min-h-screen bg-background flex items-center justify-center p-6', className)}>
      <section
        className="w-full max-w-md rounded-xl border border-border/60 bg-card p-6 shadow-sm"
        aria-label="Application startup status"
        role="status"
        aria-live="polite"
      >
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center">
            <img
              src="/logo.png"
              alt="AIOManager"
              loading="lazy"
              className={cn('h-11 w-11 object-contain', isLight && 'invert')}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-bold tracking-tight">AIOManager</p>
            <p className="text-sm text-muted-foreground">{label}</p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-border/40 bg-muted/40 px-3 py-1 text-xs font-semibold text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" aria-hidden="true" />
            Loading
          </div>
        </div>

        <div className="space-y-4">
          <ol className="space-y-2" aria-atomic="true">
            {steps.map((step, index) => {
              const isActive = index === activeStep
              const isComplete = index < activeStep

              return (
                <li
                  key={step}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border px-3 py-2',
                    isActive
                      ? 'border-primary/20 bg-primary/10'
                      : isComplete
                        ? 'border-success/20 bg-success/10'
                        : 'border-border/40 bg-muted/20'
                  )}
                >
                  <span
                    className={cn(
                      'flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold',
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : isComplete
                          ? 'bg-success text-success-foreground'
                          : 'bg-muted text-muted-foreground'
                    )}
                  >
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 text-sm font-medium text-foreground">{step}</span>
                  <span
                    className={cn(
                      'text-xs font-medium',
                      isActive ? 'text-primary' : isComplete ? 'text-success' : 'text-muted-foreground'
                    )}
                  >
                    {isActive ? 'Active' : isComplete ? 'Done' : 'Queued'}
                  </span>
                </li>
              )
            })}
          </ol>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Workspace readiness</span>
              <span className="font-mono text-xs text-muted-foreground">{progress}%</span>
            </div>
            <div
              className="h-2 overflow-hidden rounded-full bg-muted/40"
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Workspace readiness"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

export function LoadingScreen() {
  return <AppLoader variant="boot" />
}
