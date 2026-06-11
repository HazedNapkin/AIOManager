import * as React from 'react'
import { cn } from '@/lib/utils'

type StatusChipVariant = 'muted' | 'primary' | 'success' | 'warning' | 'destructive'
type StatusChipSize = 'sm' | 'md'

const variantClasses: Record<StatusChipVariant, string> = {
  muted: 'border-border/40 bg-muted/40 text-muted-foreground',
  primary: 'border-primary/25 bg-primary/12 text-primary',
  success: 'border-success/25 bg-success/10 text-success',
  warning: 'border-warning/25 bg-warning/10 text-warning',
  destructive: 'border-destructive/25 bg-destructive/10 text-destructive',
}

const sizeClasses: Record<StatusChipSize, string> = {
  sm: 'h-6 px-2 text-xs',
  md: 'h-8 px-3 text-xs',
}

export interface StatusChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  icon?: React.ReactNode
  variant?: StatusChipVariant
  size?: StatusChipSize
}

function StatusChip({
  icon,
  variant = 'muted',
  size = 'sm',
  className,
  children,
  ...props
}: StatusChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap',
        variantClasses[variant],
        sizeClasses[size],
        '[&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:shrink-0',
        className
      )}
      {...props}
    >
      {icon}
      {children}
    </span>
  )
}

export { StatusChip }
