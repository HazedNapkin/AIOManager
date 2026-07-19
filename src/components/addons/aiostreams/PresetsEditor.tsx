import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { AddonIcon } from '@/components/ui/addon-icon'
import { cn } from '@/lib/utils'
import { generateInstanceId, buildCustomPreset, normalizeManifestUrl } from '@/lib/aiostreams-inject'
import { useToast } from '@/hooks/use-toast'
import {
    Check, X, Trash2, Plus, ArrowUp, ArrowDown, Loader2, AlertCircle,
} from 'lucide-react'

interface PresetsEditorProps {
    value: unknown
    onSave: (val: unknown[]) => void
    onCancel: () => void
    saving?: boolean
}

function getNested(addon: Record<string, unknown>, field: string): unknown {
    const options = addon.options
    if (options && typeof options === 'object' && !Array.isArray(options)) {
        const opts = options as Record<string, unknown>
        if (field in opts) return opts[field]
    }
    return addon[field]
}

function setNested(addon: Record<string, unknown>, field: string, val: unknown): Record<string, unknown> {
    const options = addon.options
    if (options && typeof options === 'object' && !Array.isArray(options)) {
        return { ...addon, options: { ...(options as Record<string, unknown>), [field]: val } }
    }
    return { ...addon, [field]: val }
}

export function PresetsEditor({ value, onSave, onCancel, saving }: PresetsEditorProps) {
    const { toast } = useToast()
    const addons = (Array.isArray(value) ? value : []) as Record<string, unknown>[]
    const [local, setLocal] = useState<Record<string, unknown>[]>(
        addons.map(a => ({ ...a }))
    )
    const [manifestUrl, setManifestUrl] = useState('')
    const [adding, setAdding] = useState(false)
    const [addError, setAddError] = useState('')

    const updateAddon = (idx: number, field: string, val: unknown) => {
        setLocal(prev => {
            const next = [...prev]
            next[idx] = setNested(next[idx], field, val)
            return next
        })
    }

    const toggleEnabled = (idx: number, enabled: boolean) => {
        setLocal(prev => {
            const next = [...prev]
            next[idx] = { ...next[idx], enabled }
            return next
        })
    }

    const removeAddon = (idx: number) => {
        setLocal(prev => prev.filter((_, i) => i !== idx))
    }

    const moveAddon = (idx: number, dir: -1 | 1) => {
        setLocal(prev => {
            const target = idx + dir
            if (target < 0 || target >= prev.length) return prev
            const next = [...prev]
            const tmp = next[idx]
            next[idx] = next[target]
            next[target] = tmp
            return next
        })
    }

    const addFromManifest = async () => {
        const url = manifestUrl.trim()
        if (!url) return
        const normalizedUrl = normalizeManifestUrl(url)
        const alreadyExists = local.some(p => {
            const opts = p.options
            if (opts && typeof opts === 'object' && !Array.isArray(opts)) {
                const mUrl = (opts as Record<string, unknown>).manifestUrl
                return typeof mUrl === 'string' && normalizeManifestUrl(mUrl) === normalizedUrl
            }
            return false
        })
        if (alreadyExists) {
            setAddError('This manifest URL is already in your presets.')
            return
        }
        setAdding(true)
        setAddError('')
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 10000)
        try {
            const proxyUrl = `/api/meta-proxy?url=${encodeURIComponent(url)}`
            const res = await fetch(proxyUrl, { signal: controller.signal })
            if (res.status === 401 || res.status === 403) {
                const fallbackName = url.replace(/^https?:\/\/[^/]+\//, '').split('/')[0] || 'Custom Addon'
                const instanceId = generateInstanceId(local)
                const preset = buildCustomPreset(fallbackName, url, instanceId)
                setLocal(prev => [...prev, preset as Record<string, unknown>])
                setManifestUrl('')
                toast({
                    title: 'Manifest requires authentication',
                    description: 'Added with a generated name. Verify this addon works in AIOStreams.',
                    variant: 'warning',
                })
            } else if (!res.ok) {
                throw new Error(`HTTP ${res.status}`)
            } else {
                const json = await res.json() as { name?: string; id?: string; logo?: string }
                const name = (json.name && String(json.name)) || url.replace(/^https?:\/\/[^/]+\//, '').split('/')[0] || 'Custom Addon'
                const instanceId = generateInstanceId(local)
                const preset = buildCustomPreset(name, url, instanceId)
                setLocal(prev => [...prev, preset as Record<string, unknown>])
                setManifestUrl('')
            }
        } catch (e: unknown) {
            if (e instanceof DOMException && e.name === 'AbortError') {
                setAddError('Request timed out')
            } else if (e instanceof TypeError) {
                const fallbackName = url.replace(/^https?:\/\/[^/]+\//, '').split('/')[0] || 'Custom Addon'
                const instanceId = generateInstanceId(local)
                const preset = buildCustomPreset(fallbackName, url, instanceId)
                setLocal(prev => [...prev, preset as Record<string, unknown>])
                setManifestUrl('')
                toast({
                    title: 'Manifest unavailable',
                    description: 'Could not fetch addon details. Added with a generated name.',
                    variant: 'warning',
                })
            } else {
                setAddError(e instanceof Error ? e.message : 'Failed to load manifest')
            }
        } finally {
            clearTimeout(timeout)
            setAdding(false)
        }
    }

    const handleSave = () => onSave(local)

    return (
        <div className="bg-muted/10 border border-border/30 rounded-2xl p-4 space-y-4 shadow-sm animate-in fade-in duration-200">
            <div className="flex items-center justify-between border-b border-border/20 pb-3">
                <h3 className="font-semibold text-sm">Addons Editor</h3>
                <span className="text-xs text-muted-foreground">{local.length} preset{local.length !== 1 ? 's' : ''}</span>
            </div>

            <div className="border border-border/20 rounded-lg p-2.5 space-y-2 bg-background/40">
                <span className="text-xs text-muted-foreground font-medium block">Add via manifest URL</span>
                <div className="flex gap-2">
                    <Input
                        type="url"
                        value={manifestUrl}
                        onChange={e => {
                            setManifestUrl(e.target.value)
                            if (addError) setAddError('')
                        }}
                        placeholder="https://example.com/manifest.json"
                        disabled={adding}
                        className="text-xs h-8 flex-1 bg-muted/5 font-mono"
                        onKeyDown={e => {
                            if (e.key === 'Enter' && !adding && manifestUrl.trim()) {
                                e.preventDefault()
                                addFromManifest()
                            }
                        }}
                    />
                    <Button
                        type="button"
                        size="sm"
                        className="h-8 gap-1.5 text-xs"
                        onClick={addFromManifest}
                        disabled={adding || !manifestUrl.trim()}
                    >
                        {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                        Add
                    </Button>
                </div>
                {addError && (
                    <p className="text-xs text-destructive flex items-center gap-1.5">
                        <AlertCircle className="w-3 h-3 shrink-0" />
                        {addError}
                    </p>
                )}
            </div>

            <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1 custom-scrollbar">
                {local.length === 0 && (
                    <p className="text-xs text-muted-foreground italic text-center py-4">No addons configured</p>
                )}
                {local.map((addon, idx) => {
                    const rawName = getNested(addon, 'name')
                    const name = String(rawName || addon.type || getNested(addon, 'id') || addon.instanceId || `Addon ${idx + 1}`)
                    const isEnabled = addon.enabled !== false
                    const logo = getNested(addon, 'logo') as string | undefined
                    const idValue = String(getNested(addon, 'id') || addon.instanceId || '')
                    const timeoutValue = getNested(addon, 'timeout')

                    return (
                        <div
                            key={String(addon.instanceId || getNested(addon, 'id') || `idx-${idx}`)}
                            className={cn(
                                'border rounded-lg p-3 space-y-2 transition-colors',
                                isEnabled ? 'border-border/30 bg-background/50' : 'border-border/15 bg-muted/5 opacity-50'
                            )}
                        >
                            <div className="flex items-center gap-2">
                                <div className="flex flex-col gap-0.5 shrink-0">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-4 w-4 p-0 text-muted-foreground/60 hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
                                        disabled={idx === 0}
                                        onClick={() => moveAddon(idx, -1)}
                                        aria-label="Move up"
                                    >
                                        <ArrowUp className="w-3 h-3" />
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-4 w-4 p-0 text-muted-foreground/60 hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
                                        disabled={idx === local.length - 1}
                                        onClick={() => moveAddon(idx, 1)}
                                        aria-label="Move down"
                                    >
                                        <ArrowDown className="w-3 h-3" />
                                    </Button>
                                </div>
                                <AddonIcon
                                    name={name}
                                    logo={logo}
                                    className="h-5 w-5"
                                    textClassName="text-xs"
                                    imageClassName="p-0.5"
                                />
                                <Input
                                    value={name}
                                    onChange={e => updateAddon(idx, 'name', e.target.value)}
                                    className="text-xs h-7 bg-transparent border-0 p-0 font-semibold focus-visible:ring-0 flex-1 min-w-0"
                                />
                                <Switch
                                    checked={isEnabled}
                                    onCheckedChange={v => toggleEnabled(idx, v)}
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

                            <div className="grid grid-cols-2 gap-2 pl-8">
                                <div className="space-y-0.5">
                                    <span className="text-xs text-muted-foreground font-medium">ID</span>
                                    <Input
                                        value={idValue}
                                        onChange={e => updateAddon(idx, 'id', e.target.value)}
                                        disabled={!!idValue}
                                        className="text-xs h-6 bg-muted/5 font-mono"
                                    />
                                </div>
                                <div className="space-y-0.5">
                                    <span className="text-xs text-muted-foreground font-medium">Timeout (ms)</span>
                                    <Input
                                        type="number"
                                        value={timeoutValue == null ? '' : Number(timeoutValue)}
                                        onChange={e => updateAddon(idx, 'timeout', e.target.value === '' ? undefined : Number(e.target.value))}
                                        className="text-xs h-6 bg-muted/5 font-mono"
                                    />
                                </div>
                            </div>
                        </div>
                    )
                })}
            </div>

            <div className="flex gap-2 pt-2 border-t border-border/20">
                <Button onClick={onCancel} disabled={saving} variant="ghost" className="flex-1 h-8 text-xs gap-1.5 rounded-lg">
                    <X className="w-3.5 h-3.5" /> Cancel
                </Button>
                <Button onClick={handleSave} disabled={saving} className="flex-1 h-8 text-xs gap-1.5 rounded-lg">
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Save Changes
                </Button>
            </div>
        </div>
    )
}
