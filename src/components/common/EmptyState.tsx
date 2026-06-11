import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  secondaryAction?: React.ReactNode
  className?: string
  variant?: 'empty' | 'warning' | 'error'
}

export function EmptyState({ icon, title, description, action, secondaryAction, className, variant = 'empty' }: EmptyStateProps) {
  const variants = {
    empty: 'border-dashed border-border/40 bg-muted/5',
    warning: 'border-warning/25 bg-warning/5',
    error: 'border-destructive/25 bg-destructive/5',
  }

  return (
    <div className={cn(
      'text-center py-12 rounded-xl border',
      variants[variant],
      className
    )}>
      {icon && (
        <div className="flex justify-center mb-4">
          <div className="w-12 h-12 rounded-full bg-muted/40 flex items-center justify-center text-muted-foreground">
            {icon}
          </div>
        </div>
      )}
      <h3 className="text-base font-semibold text-muted-foreground">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground/60 mt-1 max-w-sm mx-auto">{description}</p>
      )}
      {(action || secondaryAction) && (
        <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  )
}
