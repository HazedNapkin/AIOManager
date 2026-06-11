import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { X } from 'lucide-react'
import { ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Tooltip } from '@/components/ui/tooltip'

export interface FloatingActionItem {
    label: string
    icon?: ReactNode
    onClick: () => void
    variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link'
    disabled?: boolean
}

interface FloatingActionBarProps {
    open: boolean
    selectedCount: number
    totalCount?: number
    onClearSelection: () => void
    actions: FloatingActionItem[]
    className?: string
}

export function FloatingActionBar({
    open,
    selectedCount,
    totalCount,
    onClearSelection,
    actions,
    className
}: FloatingActionBarProps) {
    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    key="fab"
                    initial={{ opacity: 0, y: 20, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 20, scale: 0.95 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    className={cn(
                        "fixed bottom-[calc(env(safe-area-inset-bottom,0px)+5.5rem)] md:bottom-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] left-1/2 -translate-x-1/2 z-50 pointer-events-none",
                        "w-[calc(100vw-1.25rem)] max-w-xl md:max-w-2xl",
                        className
                    )}
                >
                    <div className="pointer-events-auto overflow-hidden rounded-[1.75rem] border border-border/50 bg-card/95 shadow-[0_18px_60px_rgba(0,0,0,0.28)] backdrop-blur-xl">
                        {/* Top row: count + dismiss */}
                        <div className="flex items-center justify-between gap-3 border-b border-border/35 px-3 py-2.5 sm:px-4">
                            <div className="flex items-center gap-2">
                                <span className="min-w-[1.75rem] rounded-full bg-primary px-2 py-1 text-center text-xs font-bold tabular-nums text-primary-foreground shadow-sm">
                                    {selectedCount}
                                </span>
                                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    selected{totalCount ? <span className="text-muted-foreground/60"> / {totalCount}</span> : ''}
                                </span>
                            </div>
                            <Tooltip content="Clear selection" side="top">
                                <button
                                    onClick={onClearSelection}
                                    className="rounded-full border border-border/30 bg-muted/25 p-1.5 text-muted-foreground/70 transition-colors hover:bg-muted/60 hover:text-foreground"
                                    aria-label="Clear selection"
                                >
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            </Tooltip>
                        </div>

                        {/* Actions row */}
                        <div className="grid grid-cols-2 gap-1.5 p-2 sm:flex sm:flex-wrap sm:items-center sm:gap-1.5">
                            {actions.map((action, index) => (
                                <Button
                                    key={index}
                                    size="sm"
                                    variant="ghost"
                                    onClick={action.onClick}
                                    disabled={action.disabled}
                                    className={cn(
                                        "h-8 w-full shrink-0 gap-1.5 rounded-xl text-xs font-semibold sm:w-auto",
                                        action.variant === 'destructive'
                                            ? "border border-destructive/20 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                            : action.variant === 'default'
                                            ? "border border-primary/25 bg-primary/12 text-primary hover:bg-primary/20"
                                            : "border border-border/25 bg-muted/20 text-foreground/80 hover:bg-muted/70 hover:text-foreground"
                                    )}
                                >
                                    {action.icon}
                                    {action.label}
                                </Button>
                            ))}
                        </div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    )
}
