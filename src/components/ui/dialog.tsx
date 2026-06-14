import * as React from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { X } from 'lucide-react'

const DialogContext = React.createContext<{ onOpenChange?: (open: boolean) => void; titleId?: string }>({})

interface DialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: React.ReactNode
}

const Dialog = ({ open, onOpenChange, children }: DialogProps) => {
  const [mounted, setMounted] = React.useState(false)
  const [visible, setVisible] = React.useState(false)
  const titleId = React.useId()
  const dialogRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (open) {
      setMounted(true)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true))
      })
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
      document.documentElement.style.overflow = 'hidden'
      document.documentElement.style.paddingRight = `${scrollbarWidth}px`
      return () => {
        document.documentElement.style.overflow = ''
        document.documentElement.style.paddingRight = ''
      }
    } else {
      setVisible(false)
      const timer = setTimeout(() => setMounted(false), 200)
      return () => clearTimeout(timer)
    }
  }, [open])

  React.useEffect(() => {
    if (!open || !mounted) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const container = dialogRef.current
    if (!container) return
    requestAnimationFrame(() => {
      const preferredFocus = container.querySelector<HTMLElement>('[data-autofocus="true"], [autofocus]')
      if (preferredFocus) {
        preferredFocus.focus({ preventScroll: true })
        return
      }
      container.focus({ preventScroll: true })
    })
    return () => {
      if (previouslyFocused && previouslyFocused.focus) {
        previouslyFocused.focus()
      }
    }
  }, [open, mounted])

  const handleKeyDown = React.useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Escape') {
      onOpenChange?.(false)
      return
    }
    if (e.key === 'Tab') {
      const container = dialogRef.current
      if (!container) return
      const focusable = container.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])')
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (document.activeElement === container) {
        e.preventDefault()
        const focusTarget = e.shiftKey ? last : first
        focusTarget.focus()
        return
      }
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
  }, [onOpenChange])

  if (!mounted) return null

  return createPortal(
    <DialogContext.Provider value={{ onOpenChange, titleId }}>
      <div 
        ref={dialogRef}
        className="fixed inset-0 z-50" 
        style={{ overflow: 'hidden' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div
          className={cn(
            'fixed inset-0 bg-black/50 transition-opacity duration-100',
            visible ? 'opacity-100' : 'opacity-0'
          )}
          onClick={(e) => {
            e.stopPropagation()
            onOpenChange?.(false)
          }}
        />
        {React.Children.map(children, child => {
          if (React.isValidElement(child)) {
            return React.cloneElement(child as React.ReactElement<any>, { 'data-state': visible ? 'open' : 'closed' })
          }
          return child
        })}
      </div>
    </DialogContext.Provider>,
    document.body
  )
}

const DialogContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { 'data-state'?: string; hideClose?: boolean }>(
  ({ className, children, hideClose = false, ...props }, ref) => {
    const { onOpenChange, titleId } = React.useContext(DialogContext)
    const state = props['data-state'] || 'open'
    return (
      <div
        ref={ref}
        aria-labelledby={titleId}
        className={cn(
          'fixed left-[50%] top-[50%] z-50 grid w-[95vw] sm:w-full max-w-lg gap-4 p-4 sm:p-6 overflow-y-auto overflow-x-hidden max-h-[85vh] sm:max-h-[95vh]',
          'rounded-2xl border border-border/40',
          'bg-card',
          'shadow-[0_24px_64px_hsl(0_0%_0%/0.24)]',
          'transition-opacity duration-150 ease-out',
          'translate-x-[-50%] translate-y-[-50%]',
          state === 'open' ? 'opacity-100' : 'opacity-0',
          className
        )}
        {...props}
      >
        {children}
        {!hideClose && (
          <button
            type="button"
            onClick={() => onOpenChange?.(false)}
            aria-label="Close dialog"
            className="absolute right-4 top-4 flex items-center justify-center rounded-full bg-muted/30 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <X className="h-3.5 w-3.5" />
            <span className="sr-only">Close</span>
          </button>
        )}
      </div>
    )
  }
)
DialogContent.displayName = 'DialogContent'

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col space-y-2 text-center sm:text-left min-w-0', className)} {...props} />
)
DialogHeader.displayName = 'DialogHeader'

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:items-center sm:justify-end min-w-0 [&_button]:h-11 [&_button]:w-full [&_button]:rounded-full [&_button]:px-5 sm:[&_button]:w-auto', className)}
    {...props}
  />
)
DialogFooter.displayName = 'DialogFooter'

const DialogTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => {
    const { titleId } = React.useContext(DialogContext)
    return (<h2
      ref={ref}
      id={titleId}
      className={cn('text-lg font-bold leading-tight tracking-tight min-w-0', className)}
      {...props}
    />)
  }
)
DialogTitle.displayName = 'DialogTitle'

const DialogDescription = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (<div ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />)
)
DialogDescription.displayName = 'DialogDescription'

export { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription }
