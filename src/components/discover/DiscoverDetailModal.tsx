import { lazy, Suspense, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { StatusChip } from '@/components/ui/status-chip'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip } from '@/components/ui/tooltip'
import { Check, ChevronDown, ExternalLink, FileText, Plus, Settings2, Star, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  fetchDiscoverAddon,
  getAddonResources,
  getConfigureUrl,
  lastUpdatedLabel,
  requiresConfiguration,
  RESOURCE_LABELS,
  type DiscoverAddon,
  type DiscoverAddonDetail,
} from '@/api/discover'
import { AddonLogo } from './AddonLogo'

const DiscoverMarkdown = lazy(() => import('./DiscoverMarkdown'))

interface DiscoverDetailModalProps {
  addon: DiscoverAddon | null
  open: boolean
  onOpenChange: (open: boolean) => void
  saved: boolean
  isSaved?: (addon: DiscoverAddon) => boolean
  onSave: (addon: DiscoverAddon) => void
  onDeploy: (addon: DiscoverAddon) => void
  onConfigure: (addon: DiscoverAddon) => void
}

export function DiscoverDetailModal({ addon, open, onOpenChange, saved, isSaved, onSave, onDeploy, onConfigure }: DiscoverDetailModalProps) {
  const [detail, setDetail] = useState<DiscoverAddonDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [descExpanded, setDescExpanded] = useState(false)
  const [docsExpanded, setDocsExpanded] = useState(false)

  useEffect(() => {
    if (!open || !addon) return
    let active = true
    setDetail(null)
    setLoading(true)
    setDescExpanded(false)
    setDocsExpanded(false)
    fetchDiscoverAddon(addon.slug || addon.uuid)
      .then((d) => { if (active) setDetail(d) })
      .catch(() => { if (active) setDetail(null) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
    // Refetch only when the dialog opens or the target addon changes, not on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, addon?.slug, addon?.uuid])

  if (!addon) return null

  // Fall back to the list payload until the detail request resolves.
  const view: DiscoverAddon = detail ?? addon
  const manifest = view.manifest ?? ({} as DiscoverAddon['manifest'])
  const name = manifest.name?.trim() || view.slug || 'Unknown Addon'
  const description = manifest.description?.trim() || ''
  const types = Array.isArray(manifest.types) ? manifest.types.filter((t): t is string => typeof t === 'string') : []
  const resources = getAddonResources(view)
  const needsConfig = requiresConfiguration(view)
  const configureUrl = getConfigureUrl(view)
  const instances = detail?.instances ?? []
  const documentation = detail?.documentation?.trim() || ''
  const updated = lastUpdatedLabel(view)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 pr-6">
            <AddonLogo src={manifest.logo} name={name} className="h-10 w-10" />
            <span className="min-w-0 flex-1 truncate">{name}</span>
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-3">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusChip className="gap-1">
                <Star className="h-3 w-3 fill-warning text-warning" />
                {(view.stars ?? 0).toLocaleString()}
              </StatusChip>
              {needsConfig && (
                <StatusChip className="gap-1 text-warning">
                  <Settings2 className="h-3 w-3" />
                  Needs config
                </StatusChip>
              )}
              {resources.map((r) => <StatusChip key={r}>{RESOURCE_LABELS[r] ?? r}</StatusChip>)}
              {types.map((t) => <StatusChip key={t} className="capitalize text-muted-foreground/80">{t}</StatusChip>)}
            </div>

            {updated && <p className="-mt-1 text-xs text-muted-foreground">{updated}</p>}

            {description && (
              <div>
                <p className={cn('text-sm leading-relaxed text-muted-foreground', !descExpanded && 'line-clamp-4')}>{description}</p>
                {description.length > 280 && (
                  <button type="button" className="mt-1 text-xs font-medium text-primary hover:underline" onClick={() => setDescExpanded((v) => !v)}>
                    {descExpanded ? 'Show less' : 'Show more'}
                  </button>
                )}
              </div>
            )}

            {view.categories?.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {view.categories.map((c) => (
                  <span key={c.slug} className="rounded-full border border-border/40 bg-muted/30 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">{c.name}</span>
                ))}
              </div>
            )}

            {loading && <Skeleton className="h-16 w-full rounded-lg" />}

            {documentation && (
              <div className="rounded-xl border border-border/40 bg-muted/20">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
                  onClick={() => setDocsExpanded((v) => !v)}
                >
                  <span className="flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5" />
                    Documentation
                  </span>
                  <ChevronDown className={cn('h-4 w-4 transition-transform', docsExpanded && 'rotate-180')} />
                </button>
                {docsExpanded && (
                  <div className="border-t border-border/40 px-3 py-3">
                    <Suspense fallback={<Skeleton className="h-12 w-full rounded-lg" />}>
                      <DiscoverMarkdown content={documentation} />
                    </Suspense>
                  </div>
                )}
              </div>
            )}

            {instances.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Other instances ({instances.length})
                </p>
                <div className="space-y-1.5">
                  {instances.map((inst) => {
                    const instName = inst.manifest?.name?.trim() || inst.slug || 'Unknown addon'
                    const instHost = (() => { try { return new URL(inst.manifestUrl).hostname.replace(/^www\./, '') } catch { return '' } })()
                    const instSaved = isSaved?.(inst) ?? false
                    const instConfigUrl = getConfigureUrl(inst)
                    const instNeedsConfig = requiresConfiguration(inst)
                    return (
                      <div key={inst.uuid} className="flex items-center gap-2.5 rounded-lg border border-border/40 bg-muted/20 px-2.5 py-2">
                        <AddonLogo src={inst.manifest?.logo} name={instName} className="h-8 w-8" letterClassName="text-xs" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{instName}</p>
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
                            {instHost && <span className="truncate font-mono">{instHost}</span>}
                            <span className="flex shrink-0 items-center gap-0.5">
                              <Star className="h-3 w-3 fill-warning text-warning" />
                              {(inst.stars ?? 0).toLocaleString()}
                            </span>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          {instSaved ? (
                            <Tooltip content="In Library" side="top">
                              <Button size="sm" variant="subtle" disabled className="h-7 w-7 p-0">
                                <Check className="h-3.5 w-3.5" />
                              </Button>
                            </Tooltip>
                          ) : (
                            <Tooltip content={instNeedsConfig ? 'Save unconfigured' : 'Save to Library'} side="top">
                              <Button size="sm" variant="subtle" className="h-7 w-7 p-0" onClick={() => onSave(inst)}>
                                <Plus className="h-3.5 w-3.5" />
                              </Button>
                            </Tooltip>
                          )}
                          {instConfigUrl && (
                            <Tooltip content="Configure" side="top">
                              <Button size="sm" variant="subtle" className="h-7 w-7 p-0" onClick={() => onConfigure(inst)}>
                                <Settings2 className="h-3.5 w-3.5" />
                              </Button>
                            </Tooltip>
                          )}
                          <Tooltip content="Deploy to account(s)" side="top">
                            <Button size="sm" variant="subtle" className="h-7 w-7 p-0" onClick={() => onDeploy(inst)}>
                              <Upload className="h-3.5 w-3.5" />
                            </Button>
                          </Tooltip>
                          <Tooltip content="View on stremio-addons.net" side="top">
                            <Button asChild size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground">
                              <a href={inst.url} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            </Button>
                          </Tooltip>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <a
              href={view.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              View on stremio-addons.net
            </a>
          </div>
        </ScrollArea>

        <div className="flex flex-wrap items-center gap-2 border-t border-border/40 pt-4">
          {saved ? (
            <Button variant="subtle" disabled className="flex-1 gap-1.5">
              <Check className="h-4 w-4" />
              In Library
            </Button>
          ) : (
            <Button className="flex-1 gap-1.5" onClick={() => onSave(view)}>
              <Plus className="h-4 w-4" />
              {needsConfig ? 'Save anyway' : 'Save to Library'}
            </Button>
          )}
          <Button variant="subtle" className="gap-1.5" onClick={() => onDeploy(view)}>
            <Upload className="h-4 w-4" />
            Deploy
          </Button>
          {configureUrl && (
            <Button variant="subtle" className="gap-1.5" onClick={() => onConfigure(view)}>
              <Settings2 className="h-4 w-4" />
              Configure
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
