import { ChevronRight } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'

export interface BulkAccountPickerProps {
    label: string
    accounts: { id: string; name?: string; email?: string; emoji?: string }[]
    expanded: boolean
    onExpandedChange: (v: boolean) => void
    selected: Set<string>
    onSelectedChange: (v: Set<string>) => void
    disabled?: boolean
}

export function BulkAccountPicker({
    label, accounts, expanded, onExpandedChange, selected, onSelectedChange, disabled,
}: BulkAccountPickerProps) {
    return (
        <div className="mt-1">
            <button
                type="button"
                onClick={() => onExpandedChange(!expanded)}
                disabled={disabled}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
                <ChevronRight className={cn('w-3 h-3 transition-transform', expanded && 'rotate-90')} />
                {label}
                {selected.size > 0 && <span className="font-medium text-foreground">({selected.size} selected)</span>}
            </button>
            {expanded && (
                <div className="mt-2 space-y-0.5 pl-4">
                    {accounts.map(acc => {
                        const checked = selected.has(acc.id)
                        const name = acc.emoji ? `${acc.emoji} ${acc.name || acc.email || acc.id}` : (acc.name || acc.email || acc.id)
                        return (
                            <label key={acc.id} className="flex items-center gap-2 text-xs cursor-pointer rounded px-1.5 py-1 hover:bg-muted/40">
                                <Checkbox
                                    checked={checked}
                                    onCheckedChange={(c) => {
                                        const next = new Set(selected)
                                        if (c) next.add(acc.id)
                                        else next.delete(acc.id)
                                        onSelectedChange(next)
                                    }}
                                    disabled={disabled}
                                    className="h-3.5 w-3.5"
                                />
                                <span className="truncate">{name}</span>
                            </label>
                        )
                    })}
                </div>
            )}
        </div>
    )
}