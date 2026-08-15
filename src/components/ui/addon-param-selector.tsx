import { useState, useEffect, useCallback, useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tag, Layers } from 'lucide-react'
import {
    getAddonParamType,
    extractAddonParams,
    buildTaggedUrl,
    buildVariantUrl,
    extractVariantsFromConfig,
    getVariantSelectorLocation,
    NO_SELECTION,
    type VariantInfo,
} from '@/lib/addon-params'
import { cn } from '@/lib/utils'

interface AddonParamSelectorProps {
    url: string
    onUrlChange: (url: string) => void
    config?: Record<string, unknown>
    manifest?: { id?: string; name?: string } | null
    className?: string
    compact?: boolean
}

export function AddonParamSelector({ url, onUrlChange, config, manifest, className, compact }: AddonParamSelectorProps) {
    const addonType = useMemo(() => getAddonParamType(url, manifest), [url, manifest])
    const { base, params } = useMemo(() => extractAddonParams(url), [url])

    const [tag, setTag] = useState(params.tag || '')
    const [variant, setVariant] = useState(params.variant || '')

    useEffect(() => {
        const { params: extracted } = extractAddonParams(url)
        setTag(extracted.tag || '')
        setVariant(extracted.variant || '')
    }, [url])

    const applyParams = useCallback((newTag: string, newVariant: string) => {
        let result = base
        if (newVariant && addonType === 'aiostreams') {
            const variantLocation = config ? getVariantSelectorLocation(config) : 'query'
            result = buildVariantUrl(result, newVariant, variantLocation)
        }
        if (newTag && addonType === 'aiometadata') {
            result = buildTaggedUrl(result, newTag)
        }
        onUrlChange(result)
    }, [base, addonType, config, onUrlChange])

    const handleTagChange = (value: string) => {
        setTag(value)
        applyParams(value, variant)
    }

    const handleVariantChange = (value: string) => {
        setVariant(value)
        applyParams(tag, value)
    }

    if (!addonType) return null

    const availableVariants: VariantInfo[] = config ? extractVariantsFromConfig(config) : []

    return (
        <div className={cn('space-y-3', className)}>
            {!compact && (
                <div className="flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {addonType === 'aiometadata' ? 'Catalogue Tags' : 'Configuration Variants'}
                    </span>
                </div>
            )}

            <div className={cn('gap-3', compact ? 'flex flex-col' : 'grid grid-cols-1 sm:grid-cols-2')}>
                {addonType === 'aiometadata' && (
                    <div className="space-y-1.5">
                        {!compact && <Label htmlFor="addon-tag" className="text-xs">Tag</Label>}
                        <div className="relative">
                            <Tag className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                            <Input
                                id="addon-tag"
                                type="text"
                                value={tag}
                                onChange={(e) => handleTagChange(e.target.value)}
                                placeholder="e.g., movies, series, anime"
                                className={cn(compact ? 'h-8 pl-9 text-xs' : 'pl-9')}
                            />
                        </div>
                        <p className="text-[11px] text-muted-foreground/70">
                            Choose which category lists (Movies, Series, Anime) show up in Stremio.
                        </p>
                    </div>
                )}

                {addonType === 'aiostreams' && (
                    <div className="space-y-1.5">
                        {!compact && <Label htmlFor="addon-variant" className="text-xs">Variant</Label>}
                        {availableVariants.length > 0 ? (
                            <Select value={variant || NO_SELECTION} onValueChange={(v) => handleVariantChange(v === NO_SELECTION ? '' : v)}>
                                <SelectTrigger id="addon-variant" className={compact ? 'h-8 text-xs' : ''}>
                                    <SelectValue placeholder="Base config (no variant)" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={NO_SELECTION}>Base config (no variant)</SelectItem>
                                    {availableVariants.map(v => (
                                        <SelectItem key={v.id} value={v.id}>
                                            {v.name || v.id}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        ) : (
                            <div className="relative">
                                <Layers className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                                <Input
                                    id="addon-variant"
                                    type="text"
                                    value={variant}
                                    onChange={(e) => handleVariantChange(e.target.value)}
                                    placeholder="e.g., phone, torrentio-only"
                                    className={cn(compact ? 'h-8 pl-9 text-xs' : 'pl-9')}
                                />
                            </div>
                        )}
                        <p className="text-[11px] text-muted-foreground/70">
                            Pick a saved preset (e.g. phone, torrentio-only) that changes how streams are filtered.
                        </p>
                    </div>
                )}
            </div>

            {(tag || variant) && (
                <div className="flex flex-wrap items-center gap-1.5">
                    {tag && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                            <Tag className="h-2.5 w-2.5" />
                            {tag}
                        </span>
                    )}
                    {variant && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                            <Layers className="h-2.5 w-2.5" />
                            {variant}
                        </span>
                    )}
                </div>
            )}
        </div>
    )
}
