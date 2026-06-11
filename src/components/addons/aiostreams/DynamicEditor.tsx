import { useState } from 'react'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { KeyRound, Eye, EyeOff, Plus, Trash2, Check, X } from 'lucide-react'
import { useVaultStore } from '@/store/vaultStore'
import { cn } from '@/lib/utils'

interface DynamicEditorProps {
    sectionKey: string
    value: unknown
    onSave: (val: unknown) => void
    onCancel: () => void
}

function isSecretKey(key: string): boolean {
    const k = key.toLowerCase()
    return k.includes('password') || k.includes('key') || k.includes('token') || k.includes('secret') || k.includes('api')
}

function PasswordInputWithVault({
    label,
    value,
    onChange,
}: {
    label: string
    value: string
    onChange: (val: string) => void
}) {
    const [showPassword, setShowPassword] = useState(false)
    const vaultKeys = useVaultStore((s) => s.keys)

    const handleInject = (valueToInject: string) => {
        onChange(valueToInject)
    }

    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">{label}</Label>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-[10px] gap-1 bg-primary/12 text-primary hover:bg-primary/20">
                            <KeyRound className="w-3 h-3" />
                            Vault
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48 max-h-64 overflow-y-auto">
                        {vaultKeys.length === 0 ? (
                            <div className="p-2 text-xs text-muted-foreground text-center">No keys in vault</div>
                        ) : (
                            vaultKeys.map(k => (
                                <DropdownMenuItem key={k.id} onClick={() => handleInject(k.value)}>
                                    <div className="flex flex-col min-w-0">
                                        <span className="text-xs font-medium truncate">{k.name}</span>
                                        <span className="text-[10px] text-muted-foreground truncate">{k.provider}</span>
                                    </div>
                                </DropdownMenuItem>
                            ))
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
            <div className="relative">
                <Input
                    type={showPassword ? 'text' : 'password'}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    className="pr-8 bg-muted/5 text-xs h-8"
                />
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-8 w-8 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowPassword(!showPassword)}
                >
                    {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </Button>
            </div>
        </div>
    )
}

function RecursiveEditor({
    dataKey,
    value,
    onChange,
    level = 0,
    rootSection
}: {
    dataKey: string
    value: unknown
    onChange: (val: unknown) => void
    level?: number
    rootSection?: string
}) {
    // Prevent editing of specific internal identifier keys to avoid breaking AIOStreams logic
    if (dataKey === 'id' || dataKey === 'type') {
        return (
            <div className="space-y-1.5 opacity-60">
                <Label className="text-xs font-semibold">{dataKey}</Label>
                <Input
                    type="text"
                    value={String(value)}
                    disabled
                    className="bg-muted/5 text-xs h-8 cursor-not-allowed"
                />
            </div>
        )
    }

    // If it's a primitive boolean
    if (typeof value === 'boolean') {
        return (
            <div className="flex items-center justify-between p-2 rounded-lg bg-muted/5 border border-border/20">
                <Label className="text-xs font-medium truncate pr-2">{dataKey}</Label>
                <Switch
                    checked={value}
                    onCheckedChange={onChange}
                />
            </div>
        )
    }

    // If it's a primitive string or number
    if (typeof value === 'string' || typeof value === 'number') {
        const strVal = String(value)
        if (isSecretKey(dataKey)) {
            return <PasswordInputWithVault label={dataKey} value={strVal} onChange={onChange} />
        }
        return (
            <div className="space-y-1.5">
                <Label className="text-xs font-semibold">{dataKey}</Label>
                <Input
                    type={typeof value === 'number' ? 'number' : 'text'}
                    value={strVal}
                    onChange={(e) => {
                        const v = e.target.value
                        onChange(typeof value === 'number' ? (v === '' ? 0 : Number(v)) : v)
                    }}
                    className="bg-muted/5 text-xs h-8"
                />
            </div>
        )
    }

    // If it's null or undefined
    if (value === null || value === undefined) {
        return (
            <div className="space-y-1.5">
                <Label className="text-xs font-semibold">{dataKey} (null)</Label>
                <Input disabled value="null" className="bg-muted/5 text-xs h-8 opacity-50" />
            </div>
        )
    }

    // If it's an Array
    if (Array.isArray(value)) {
        if (level >= 6) {
            // Fallback for deeply nested arrays
            return (
                <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">{dataKey}</Label>
                    <Textarea
                        value={JSON.stringify(value, null, 2)}
                        onChange={(e) => {
                            try { onChange(JSON.parse(e.target.value)) } catch { /* ignore */ }
                        }}
                        className="font-mono text-[10px] min-h-[100px] bg-muted/5"
                    />
                </div>
            )
        }

        const isPrimitiveArray = value.every(item => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean')
        const canAddItem = !isPrimitiveArray && (value.length === 0 || (!('id' in value[0]) && !('type' in value[0])))

        return (
            <div className="space-y-2 border border-border/20 rounded-xl p-3 bg-muted/5">
                <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold">{dataKey}</Label>
                    {isPrimitiveArray && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[10px] gap-1"
                            onClick={() => onChange([...value, ''])}
                        >
                            <Plus className="w-3 h-3" /> Add
                        </Button>
                    )}
                </div>
                
                {value.length === 0 ? (
                    <div className="text-[10px] text-muted-foreground italic">Empty array</div>
                ) : (
                    <div className="space-y-2">
                        {value.map((item, idx) => {
                            if (typeof item === 'object' && item !== null) {
                                // Render object items as cards
                                const canDelete = !('id' in item) && !('type' in item)
                                return (
                                    <div key={idx} className="border border-border/20 rounded-lg p-3 bg-background relative pt-6">
                                        <div className="absolute top-2 right-2 flex items-center gap-1">
                                            <span className="text-[10px] text-muted-foreground mr-2">Item {idx + 1}</span>
                                            {canDelete && (
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-5 w-5 text-muted-foreground hover:text-destructive"
                                                    onClick={() => {
                                                        const newArr = [...value]
                                                        newArr.splice(idx, 1)
                                                        onChange(newArr)
                                                    }}
                                                >
                                                    <Trash2 className="w-3 h-3" />
                                                </Button>
                                            )}
                                        </div>
                                        <RecursiveEditor
                                            dataKey=""
                                            value={item}
                                            level={level + 1}
                                            rootSection={rootSection}
                                            onChange={(newItemVal) => {
                                                const newArr = [...value]
                                                newArr[idx] = newItemVal
                                                onChange(newArr)
                                            }}
                                        />
                                    </div>
                                )
                            }
                            // Primitive array item
                            return (
                                <div key={idx} className="flex gap-2 items-center">
                                    <div className="flex-1">
                                        <RecursiveEditor
                                            dataKey={`${idx}`}
                                            value={item}
                                            level={level + 1}
                                            rootSection={rootSection}
                                            onChange={(newItemVal) => {
                                                const newArr = [...value]
                                                newArr[idx] = newItemVal
                                                onChange(newArr)
                                            }}
                                        />
                                    </div>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0 mt-[22px]"
                                        onClick={() => {
                                            const newArr = [...value]
                                            newArr.splice(idx, 1)
                                            onChange(newArr)
                                        }}
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </div>
                            )
                        })}
                    </div>
                )}
                
                {canAddItem && (
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full text-xs h-7 gap-1 mt-2"
                        onClick={() => {
                            // Add a new empty object or duplicate the last one's shape
                            const shape = value.length > 0 ? Object.fromEntries(Object.keys(value[0]).map(k => [k, typeof value[0][k] === 'boolean' ? false : typeof value[0][k] === 'number' ? 0 : ''])) : {}
                            onChange([...value, shape])
                        }}
                    >
                        <Plus className="w-3 h-3" /> Add Item
                    </Button>
                )}
            </div>
        )
    }

    // If it's an Object
    if (typeof value === 'object') {
        if (level >= 6) {
            return (
                <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">{dataKey}</Label>
                    <Textarea
                        value={JSON.stringify(value, null, 2)}
                        onChange={(e) => {
                            try { onChange(JSON.parse(e.target.value)) } catch { /* ignore */ }
                        }}
                        className="font-mono text-[10px] min-h-[100px] bg-muted/5"
                    />
                </div>
            )
        }

        let keys = Object.keys(value as Record<string, unknown>)
        
        // For addons (presets), only show id, name, timeout, and enabled fields inside the addon objects
        if (rootSection === 'presets' && level === 2) {
            keys = keys.filter(k => ['id', 'name', 'timeout', 'enabled'].includes(k))
        }
        
        return (
            <div className={cn("space-y-3", level > 0 && "border-t border-border/10 pt-2 mt-2 first:border-0 first:pt-0 first:mt-0")}>
                {level === 0 ? (
                    dataKey && <Label className="text-sm font-bold block mb-4">{dataKey}</Label>
                ) : (
                    dataKey && <Label className="text-xs font-semibold block text-primary/80">{dataKey}</Label>
                )}
                <div className="grid gap-3 pl-2 border-l-2 border-border/20">
                    {keys.map((k) => (
                        <RecursiveEditor
                            key={k}
                            dataKey={k}
                            value={(value as Record<string, unknown>)[k]}
                            level={level + 1}
                            rootSection={rootSection}
                            onChange={(newVal) => {
                                onChange({ ...(value as object), [k]: newVal })
                            }}
                        />
                    ))}
                </div>
            </div>
        )
    }

    return null
}

export function DynamicEditor({ sectionKey, value, onSave, onCancel }: DynamicEditorProps) {
    const [localValue, setLocalValue] = useState(value)
    
    // For very complex structures that completely fail recursion
    const [isJsonMode, setIsJsonMode] = useState(false)
    const [jsonString, setJsonString] = useState('')
    const [jsonError, setJsonError] = useState('')

    const handleSave = () => {
        if (isJsonMode) {
            try {
                const parsed = JSON.parse(jsonString)
                onSave(parsed)
            } catch {
                setJsonError('Invalid JSON')
            }
        } else {
            onSave(localValue)
        }
    }

    return (
        <div className="bg-muted/10 border border-border/30 rounded-2xl p-4 space-y-4 shadow-sm animate-in fade-in duration-200">
            <div className="flex items-center justify-between border-b border-border/20 pb-3">
                <h3 className="font-semibold text-sm capitalize">{sectionKey === 'presets' ? 'Addons Editor' : `${sectionKey.replace(/([A-Z])/g, ' $1').trim()} Editor`}</h3>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                        if (!isJsonMode) {
                            setJsonString(JSON.stringify(localValue, null, 2))
                            setJsonError('')
                        } else {
                            try {
                                setLocalValue(JSON.parse(jsonString))
                            } catch {
                                // Ignore error when switching back, just use last valid localValue
                            }
                        }
                        setIsJsonMode(!isJsonMode)
                    }}
                    className="h-6 text-[10px] text-muted-foreground hover:text-foreground"
                >
                    {isJsonMode ? 'Visual Editor' : 'JSON Mode'}
                </Button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto pr-1 custom-scrollbar">
                {isJsonMode ? (
                    <div className="space-y-2">
                        <Textarea
                            value={jsonString}
                            onChange={(e) => {
                                setJsonString(e.target.value)
                                setJsonError('')
                            }}
                            className="font-mono text-xs min-h-[300px] bg-background/50"
                            placeholder="{}"
                        />
                        {jsonError && <p className="text-xs text-destructive font-medium">{jsonError}</p>}
                    </div>
                ) : (
                    <RecursiveEditor
                        dataKey={sectionKey === 'presets' ? 'addons' : sectionKey}
                        value={localValue}
                        onChange={setLocalValue}
                        level={0}
                        rootSection={sectionKey}
                    />
                )}
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
