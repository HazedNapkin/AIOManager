import type { ComponentProps, ReactNode } from 'react'
import { Tabs, TabsContent, TabsList } from './tabs'
import { cn } from '@/lib/utils'

type WorkspaceTabsProps = ComponentProps<typeof Tabs> & {
    label: string
    tabs: ReactNode
    actions?: ReactNode
    contentClassName?: string
    panelValue?: string
}

/** Secondary navigation and its content share one workspace boundary. */
export function WorkspaceTabs({ label, tabs, actions, children, className, contentClassName, panelValue, ...props }: WorkspaceTabsProps) {
    return <Tabs {...props} data-theme-part="panel" data-workspace="tabs" className={cn('min-w-0 rounded-2xl border border-border/40 bg-card/30 shadow-sm', className)}>
        {(tabs || actions) && <div data-theme-part="tab-workspace-header" className="flex flex-wrap items-center justify-between gap-3 rounded-t-2xl border-b border-border/40 bg-card/70 px-3 py-3 sm:px-4">
            <TabsList aria-label={label} className="max-w-full flex-wrap gap-1 rounded-xl border-0 bg-muted/25 p-1 shadow-none [&_[role=tab]]:px-3 [&_[role=tab]]:text-xs">{tabs}</TabsList>
            {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
        </div>}
        {panelValue ? <TabsContent value={panelValue} animated={false} data-theme-part="tab-workspace-body" className={cn('!mt-0 min-w-0 p-4 sm:p-5', contentClassName)}>{children}</TabsContent>
            : <div data-theme-part="tab-workspace-body" className={cn('min-w-0 p-4 sm:p-5 [&>[data-theme-part=tab-panel]]:mt-0', contentClassName)}>{children}</div>}
    </Tabs>
}
