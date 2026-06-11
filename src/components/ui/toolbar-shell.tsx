import * as React from 'react'
import { cn } from '@/lib/utils'

export interface ToolbarShellProps extends React.HTMLAttributes<HTMLDivElement> {
  contentClassName?: string
}

const ToolbarShell = React.forwardRef<HTMLDivElement, ToolbarShellProps>(
  ({ className, contentClassName, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('bg-card border border-border/40 rounded-2xl p-3 shadow-sm', className)}
      {...props}
    >
      <div className={cn('flex flex-wrap items-center gap-3', contentClassName)}>
        {children}
      </div>
    </div>
  )
)
ToolbarShell.displayName = 'ToolbarShell'

export { ToolbarShell }
