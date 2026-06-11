import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { AddonIcon } from '@/components/ui/addon-icon'
import { cn } from '@/lib/utils'
import {
    Check, X, Trash2, Plus,
} from 'lucide-react'

interface PresetsEditorProps {
    value: unknown
    onSave: (val: unknown) => void
    onCancel: () => void
}

export function PresetsEditor({ value, onSave, onCancel }: PresetsEditorProps) {
    const addons = (Array.isArray(value) ? value : []) as Record<string, unknown>[]
    const [local, setLocal] = useState<Record<string, unknown>[]>(
        addons.map(a => ({ ...a }))
    )

    const updateAddon = (idx: number, field: string, val: unknown) => {
        setLocal(prev => {
            const next = [...prev]
            next[idx] = { ...next[idx], [field]: val }
            return next
        })
    }

    const removeAddon = (idx: number) => {
        setLocal(prev => prev.filter((_, i) => i !== idx))
    }

    const addEmpty = () => {
        setLocal(prev => [...prev, { id: '', type: '', name: 'New Addon', timeout: 30000, enabled: true }])
    }

    const handleSave = () => onSave(local)

    return (
        <div className="bg-muted/10 border border-border/30 rounded-2xl p-4 space-y-4 shadow-sm animate-in fade-in duration-200">
            <div className="flex items-center justify-between border-b border-border/20 pb-3">
                <h3 className="font-semibold text-sm">Addons Editor</h3>
                <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-[10px] gap-1" onClick={addEmpty}>
                    <Plus className="w-3 h-3" /> Add
                </Button>
            </div>

            <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1 custom-scrollbar">
                {local.length === 0 && (
                    <p className="text-xs text-muted-foreground italic text-center py-4">No addons configured</p>
                )}
                {local.map((addon, idx) => {
                    const name = String(addon.name || addon.type || addon.id || `Addon ${idx + 1}`)
                    const isEnabled = addon.enabled !== false
                    const logo = addon.logo as string | undefined

                    return (
                        <div
                            key={idx}
                            className={cn(
                                'border rounded-lg p-3 space-y-2 transition-colors',
                                isEnabled ? 'border-border/30 bg-background/50' : 'border-border/15 bg-muted/5 opacity-50'
                            )}
                        >
                            <div className="flex items-center gap-2.5">
                                <AddonIcon
                                    name={name}
                                    logo={logo}
                                    className="h-5 w-5"
                                    textClassName="text-[10px]"
                                    imageClassName="p-0.5"
                                />
                                <Input
                                    value={name}
                                    onChange={e => updateAddon(idx, 'name', e.target.value)}
                                    className="text-xs h-7 bg-transparent border-0 p-0 font-semibold focus-visible:ring-0 flex-1"
                                />
                                <Switch
                                    checked={isEnabled}
                                    onCheckedChange={v => updateAddon(idx, 'enabled', v)}
                                />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="min-h-[36px] min-w-[36px] text-muted-foreground/60 hover:text-destructive shrink-0"
                                    onClick={() => removeAddon(idx)}
                                    aria-label="Remove preset"
                                >
                                    <Trash2 className="w-3 h-3" />
                                </Button>
                            </div>

                            <div className="grid grid-cols-2 gap-2 pl-7.5">
                                <div className="space-y-0.5">
                                    <span className="text-[10px] text-muted-foreground font-medium">ID</span>
                                    <Input
                                        value={String(addon.id || '')}
                                        onChange={e => updateAddon(idx, 'id', e.target.value)}
                                        disabled={!!addon.id}
                                        className="text-[10px] h-6 bg-muted/5 font-mono"
                                    />
                                </div>
                                <div className="space-y-0.5">
                                    <span className="text-[10px] text-muted-foreground font-medium">Timeout (ms)</span>
                                    <Input
                                        type="number"
                                        value={addon.timeout == null ? '' : Number(addon.timeout)}
                                        onChange={e => updateAddon(idx, 'timeout', e.target.value === '' ? undefined : Number(e.target.value))}
                                        className="text-[10px] h-6 bg-muted/5 font-mono"
                                    />
                                </div>
                            </div>
                        </div>
                    )
                })}
            </div>

            <div className="flex gap-2 pt-2 border-t border-border/20">
                <Button onClick={onCancel} variant="ghost" className="flex-1 h-8 text-xs gap-1.5 rounded-lg">
                    <X className="w-3.5 h-3.5" /> Cancel
                </Button>
                <Button onClick={handleSave} className="flex-1 h-8 text-xs gap-1.5 rounded-lg">
                    <Check className="w-3.5 h-3.5" /> Save Changes
                </Button>
            </div>
        </div>
    )
}
