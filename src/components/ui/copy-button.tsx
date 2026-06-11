import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Copy, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip } from '@/components/ui/tooltip'

interface CopyButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string
  onCopied?: () => void
  iconSize?: number
  variant?: 'ghost' | 'outline' | 'inline' | 'subtle'
}

const CopyButton = React.forwardRef<HTMLButtonElement, CopyButtonProps>(
  ({ value, onCopied, iconSize = 14, variant = 'ghost', className, children, onClick, ...props }, ref) => {
    const [copied, setCopied] = React.useState(false)
    const ariaLabel = props['aria-label'] ?? (copied ? 'Copied to clipboard' : 'Copy to clipboard')

    const handleCopy = async (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation()
      onClick?.(e)
      if (e.defaultPrevented) return

      try {
        await navigator.clipboard.writeText(value)
        setCopied(true)
        onCopied?.()
        setTimeout(() => setCopied(false), 2000)
      } catch (copyError) {
        if (import.meta.env.DEV) console.error('[CopyButton] Failed to copy to clipboard:', copyError)
      }
    }

    const variantClasses = {
      ghost: 'p-1.5 rounded-md hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors',
      outline: 'p-1.5 rounded-md border border-border/40 hover:bg-muted/40 text-muted-foreground hover:text-foreground transition-colors',
      inline: 'p-0.5 text-muted-foreground hover:text-foreground transition-colors',
      subtle: 'p-1.5 rounded-md bg-muted/40 text-muted-foreground hover:bg-muted/70 hover:text-foreground transition-colors border border-border/40',
    }

    return (
      <Tooltip content={copied ? 'Copied!' : 'Copy to clipboard'} side="top">
        <button
          ref={ref}
          type="button"
          className={cn(
            'relative inline-flex items-center justify-center shrink-0',
            variantClasses[variant],
            className
          )}
          {...props}
          onClick={handleCopy}
          aria-label={ariaLabel}
        >
          <AnimatePresence mode="wait" initial={false}>
            {copied ? (
              <motion.span
                key="check"
                initial={{ scale: 0, rotate: -90 }}
                animate={{ scale: 1, rotate: 0 }}
                exit={{ scale: 0, rotate: 90 }}
                transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                className="text-success"
              >
                <Check size={iconSize} />
              </motion.span>
            ) : (
              <motion.span
                key="copy"
                initial={{ scale: 0, rotate: 90 }}
                animate={{ scale: 1, rotate: 0 }}
                exit={{ scale: 0, rotate: -90 }}
                transition={{ type: 'spring', stiffness: 500, damping: 25 }}
              >
                <Copy size={iconSize} />
              </motion.span>
            )}
          </AnimatePresence>
          {children}
        </button>
      </Tooltip>
    )
  }
)
CopyButton.displayName = 'CopyButton'

export { CopyButton }
