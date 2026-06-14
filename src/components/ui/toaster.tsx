import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { AlertCircle, AlertTriangle, CheckCircle, X } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'

export function Toaster() {
  const { toasts, dismiss } = useToast()

  return (
    <div aria-live="polite" aria-atomic="true" className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex flex-col items-center gap-2 px-3 pt-[calc(env(safe-area-inset-top,0px)+12px)] sm:left-auto sm:right-4 sm:w-full sm:max-w-sm sm:items-stretch">
      <AnimatePresence initial={false} mode="sync">
        {toasts.map((toast) => {
          const isDestructive = toast.variant === 'destructive'
          const isWarning = toast.variant === 'warning'
          const Icon = isDestructive ? AlertCircle : isWarning ? AlertTriangle : CheckCircle

          return (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, y: -16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.96 }}
              transition={{ duration: 0.24, ease: 'easeOut' }}
              className={cn(
                "pointer-events-auto relative w-full max-w-sm overflow-hidden rounded-[1.35rem] border border-border/45 bg-card/95 text-card-foreground shadow-[0_10px_30px_rgba(0,0,0,0.12)] ring-1 ring-black/[0.03] backdrop-blur-md",
                toast.className
              )}
            >
              <div className="flex items-start gap-3 px-4 py-3.5">
                <div className={cn(
                  "mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border shadow-sm",
                  isDestructive
                    ? "border-destructive/20 bg-destructive/10 text-destructive"
                    : isWarning
                      ? "border-warning/20 bg-warning/10 text-warning"
                      : "border-border/40 bg-muted/45 text-foreground"
                )}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  {isWarning && (
                    <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/75">
                      Time Sensitive
                    </p>
                  )}
                  <p className={cn(
                    "text-sm font-semibold leading-snug",
                    isDestructive && "text-destructive"
                  )}>
                    {toast.title}
                  </p>
                  {toast.description && (
                    <p className="mt-0.5 text-sm leading-snug text-muted-foreground">
                      {toast.description}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => dismiss(toast.id)}
                  className="shrink-0 rounded-full p-1 text-muted-foreground/60 transition-colors hover:bg-muted/70 hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                  <span className="sr-only">Close</span>
                </button>
              </div>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
