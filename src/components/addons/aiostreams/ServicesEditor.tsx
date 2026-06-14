import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
    Check, X, Eye, EyeOff, Trash2,
} from 'lucide-react'

interface ServicesEditorProps {
    value: unknown
    onSave: (val: unknown) => void
    onCancel: () => void
}

const KNOWN_SERVICE_FIELDS: Record<string, string[]> = {
    realdebrid: ['apiKey'],
    premiumize: ['apiKey'],
    torbox: ['apiKey'],
    alldebrid: ['apiKey'],
    debridlink: ['apiKey'],
    putio: ['token'],
    easydebrid: ['apiKey'],
    offcloud: ['apiKey'],
    pikpak: ['email', 'password'],
}

const SECRET_FIELDS = new Set(['apiKey', 'token', 'password', 'secret', 'apiToken'])

function isSecret(field: string): boolean {
    return SECRET_FIELDS.has(field) || field.toLowerCase().includes('key') || field.toLowerCase().includes('token')
}

export function ServicesEditor({ value, onSave, onCancel }: ServicesEditorProps) {
    const services = (Array.isArray(value) ? value : []) as Record<string, unknown>[]
    const [local, setLocal] = useState<Record<string, unknown>[]>(
        services.map(s => ({ ...s }))
    )
    const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({})

    const toggleSecret = (idx: number, field: string) => {
        const key = `${idx}-${field}`
        setShowSecrets(prev => ({ ...prev, [key]: !prev[key] }))
    }

    const updateField = (idx: number, field: string, val: unknown) => {
        setLocal(prev => {
            const next = [...prev]
            next[idx] = { ...next[idx], [field]: val }
            return next
        })
    }

    const removeService = (idx: number) => {
        setLocal(prev => prev.filter((_, i) => i !== idx))
    }

    const handleSave = () => onSave(local)

    return (
        <div className="bg-muted/10 border border-border/30 rounded-2xl p-4 space-y-4 shadow-sm animate-in fade-in duration-200">
            <div className="flex items-center justify-between border-b border-border/20 pb-3">
                <h3 className="font-semibold text-sm">Services Editor</h3>
            </div>

            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1 custom-scrollbar">
                {local.length === 0 && (
                    <p className="text-xs text-muted-foreground italic text-center py-4">No services configured</p>
                )}
                {local.map((svc, idx) => {
                    const svcId = String(svc.id || svc.type || `service-${idx}`)
                    const knownFields = KNOWN_SERVICE_FIELDS[svcId.toLowerCase()] || []
                    const keys = Object.keys(svc).filter(k => k !== 'id' && k !== 'type')
                    const allFields = knownFields.length > 0
                        ? [...new Set([...knownFields, ...keys])]
                        : keys

                    return (
                        <div key={idx} className="border border-border/20 rounded-lg p-3 bg-background/50 space-y-2.5 relative">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-bold">{formatSvcName(svcId)}</span>
                                    {svc.enabled !== undefined && (
                                        <Switch
                                            checked={!!svc.enabled}
                                            onCheckedChange={v => updateField(idx, 'enabled', v)}
                                        />
                                    )}
                                </div>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6 flex items-center justify-center text-muted-foreground hover:text-destructive"
                                    onClick={() => removeService(idx)}
                                    aria-label="Remove service"
                                >
                                    <Trash2 className="w-3 h-3" />
                                </Button>
                            </div>
                            {allFields.map(field => {
                                const val = svc[field]
                                if (field === 'enabled') return null
                                const secret = isSecret(field)
                                const key = `${idx}-${field}`
                                const visible = !secret || showSecrets[key]

                                return (
                                    <div key={field} className="space-y-1">
                                        <Label className="text-xs font-semibold text-muted-foreground uppercase">{formatSvcName(field)}</Label>
                                        <div className="relative">
                                            <Input
                                                type={visible ? 'text' : 'password'}
                                                value={val == null ? '' : String(val)}
                                                onChange={e => updateField(idx, field, e.target.value)}
                                                className="bg-muted/5 text-xs h-7 pr-8 font-mono"
                                            />
                                            {secret && (
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    className="absolute right-0 top-0 h-7 w-7 flex items-center justify-center text-muted-foreground/60 hover:text-foreground"
                                                    onClick={() => toggleSecret(idx, field)}
                                                    aria-label={visible ? "Hide secret" : "Show secret"}
                                                >
                                                    {visible ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                )
                            })}
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

function formatSvcName(s: string): string {
    return s
        .replace(/([A-Z])/g, ' $1')
        .replace(/[_-]/g, ' ')
        .replace(/^./, c => c.toUpperCase())
        .trim()
}
