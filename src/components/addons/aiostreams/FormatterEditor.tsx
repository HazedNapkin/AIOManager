import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
    PREDEFINED_FORMATTERS,
} from '@/lib/aiostreams-utils'
import { cn } from '@/lib/utils'
import {
    Check, Zap, Code, X,
} from 'lucide-react'

interface FormatterEditorProps {
    value: unknown
    baseUrl: string
    onSave: (val: unknown) => void
    onCancel: () => void
}

export function FormatterEditor({ value, onSave, onCancel }: FormatterEditorProps) {
    const formatter = value as { id?: string; definition?: Record<string, unknown> } | null
    const currentId = formatter?.id || ''

    const [selectedId, setSelectedId] = useState(currentId)
    const [customDefinition, setCustomDefinition] = useState<string>(
        formatter?.definition ? JSON.stringify(formatter.definition, null, 2) : ''
    )
    const [customName, setCustomName] = useState(
        (formatter?.definition as { name?: string })?.name || ''
    )
    const [jsonError, setJsonError] = useState('')

    const handleSave = () => {
        if (selectedId === 'custom') {
            try {
                const parsed = JSON.parse(customDefinition)
                onSave({ id: 'custom', definition: { ...parsed, name: customName || 'Custom' } })
            } catch {
                setJsonError('Invalid JSON in custom definition')
                return
            }
        } else {
            onSave({ id: selectedId })
        }
    }

    return (
        <div className="bg-muted/10 border border-border/30 rounded-2xl p-4 space-y-4 shadow-sm animate-in fade-in duration-200">
            <div className="flex items-center justify-between border-b border-border/20 pb-3">
                <h3 className="font-semibold text-sm flex items-center gap-2">
                    <Zap className="w-4 h-4" />
                    Formatter
                </h3>
            </div>

            <div className="space-y-2">
                <Label className="text-xs font-semibold">Preset Formatters</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {PREDEFINED_FORMATTERS.map(fmt => (
                        <button
                            key={fmt.id}
                            type="button"
                            onClick={() => { setSelectedId(fmt.id); setJsonError('') }}
                            className={cn(
                                'flex flex-col items-start gap-0.5 p-2.5 rounded-lg border text-left transition-colors',
                                selectedId === fmt.id
                                    ? 'border-primary/25 bg-primary/12 ring-1 ring-primary/25'
                                    : 'border-border/30 bg-muted/10 hover:bg-muted/20'
                            )}
                        >
                            <div className="flex items-center gap-2 w-full">
                                <div className={cn(
                                    'w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0',
                                    selectedId === fmt.id ? 'border-primary' : 'border-border/40'
                                )}>
                                    {selectedId === fmt.id && <div className="w-1.5 h-1.5 rounded-full bg-primary" />}
                                </div>
                                <span className="text-xs font-semibold">{fmt.label}</span>
                            </div>
                            <p className="text-xs text-muted-foreground pl-5.5">{fmt.description}</p>
                        </button>
                    ))}
                    <button
                        type="button"
                        onClick={() => { setSelectedId('custom'); setJsonError('') }}
                        className={cn(
                            'flex flex-col items-start gap-0.5 p-2.5 rounded-lg border text-left transition-colors',
                            selectedId === 'custom'
                                ? 'border-primary/25 bg-primary/12 ring-1 ring-primary/25'
                                : 'border-border/30 bg-muted/10 hover:bg-muted/20'
                        )}
                    >
                        <div className="flex items-center gap-2 w-full">
                            <div className={cn(
                                'w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0',
                                selectedId === 'custom' ? 'border-primary' : 'border-border/40'
                            )}>
                                {selectedId === 'custom' && <div className="w-1.5 h-1.5 rounded-full bg-primary" />}
                            </div>
                            <Code className="w-3 h-3 text-muted-foreground" />
                            <span className="text-xs font-semibold">Custom</span>
                        </div>
                        <p className="text-xs text-muted-foreground pl-5.5">Write your own formatter definition</p>
                    </button>
                </div>
            </div>

            {selectedId === 'custom' && (
                <div className="space-y-3 border-t border-border/10 pt-3">
                    <div className="space-y-1.5">
                        <Label className="text-xs font-semibold">Name</Label>
                        <Input
                            value={customName}
                            onChange={e => setCustomName(e.target.value)}
                            placeholder="My custom formatter"
                            className="bg-muted/5 text-xs h-8"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs font-semibold">Definition (JSON)</Label>
                        <Textarea
                            value={customDefinition}
                            onChange={e => { setCustomDefinition(e.target.value); setJsonError('') }}
                            className="font-mono text-xs min-h-[150px] bg-muted/5"
                            placeholder='{"nameTemplate": "...", "descriptionTemplate": "..."}'
                        />
                        {jsonError && <p className="text-xs text-destructive">{jsonError}</p>}
                    </div>
                </div>
            )}

            <div className="flex gap-2 pt-2 border-t border-border/20">
                <Button onClick={onCancel} variant="ghost" className="flex-1 h-8 text-xs gap-1.5 rounded-lg">
                    <X className="w-3.5 h-3.5" /> Cancel
                </Button>
                <Button onClick={handleSave} className="flex-1 h-8 text-xs gap-1.5 rounded-lg">
                    <Check className="w-3.5 h-3.5" /> Apply
                </Button>
            </div>
        </div>
    )
}
