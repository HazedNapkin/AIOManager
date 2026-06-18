import React from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { StatusChip } from '@/components/ui/status-chip'
import { Tooltip } from '@/components/ui/tooltip'
import { Check, ExternalLink, Heart, Info, Loader2, Plus, Settings2, Star, Upload } from 'lucide-react'
import { getAddonResources, getConfigureUrl, lastUpdatedLabel, requiresConfiguration, RESOURCE_LABELS, type DiscoverAddon } from '@/api/discover'
import { AddonLogo } from './AddonLogo'

interface DiscoverCardProps {
  addon: DiscoverAddon
  saved: boolean
  saving: boolean
  favorite?: boolean
  compact?: boolean
  onSave: (addon: DiscoverAddon) => void
  onDeploy: (addon: DiscoverAddon) => void
  onConfigure: (addon: DiscoverAddon) => void
  onOpenDetail: (addon: DiscoverAddon) => void
  onToggleFavorite?: (addon: DiscoverAddon) => void
  deployedCount?: (addon: DiscoverAddon) => number
  accountTotal?: number
}

function DiscoverCardInner({ addon, saved, saving, favorite, compact, onSave, onDeploy, onConfigure, onOpenDetail, onToggleFavorite, deployedCount, accountTotal }: DiscoverCardProps) {
  const manifest = addon.manifest ?? ({} as DiscoverAddon['manifest'])
  const name = manifest.name?.trim() || addon.slug || 'Unknown Addon'
  const description = manifest.description?.trim() || ''
  const logo = manifest.logo
  const types = Array.isArray(manifest.types) ? manifest.types.filter((t): t is string => typeof t === 'string') : []
  const resources = getAddonResources(addon)
  const catalogCount = Array.isArray(manifest.catalogs) ? manifest.catalogs.length : 0
  const needsConfig = requiresConfiguration(addon)
  const canConfigure = !!getConfigureUrl(addon)
  const updated = lastUpdatedLabel(addon)
  const recentDays = (() => {
    if (!addon.updatedAt) return null
    const ts = new Date(addon.updatedAt).getTime()
    if (!Number.isFinite(ts)) return null
    return Math.max(0, Math.floor((Date.now() - ts) / 86_400_000))
  })()
  const isRecentlyUpdated = recentDays !== null && recentDays <= 7
  const deployedOn = deployedCount?.(addon) ?? 0
  const onAllAccounts = !!accountTotal && accountTotal > 0 && deployedOn >= accountTotal

  if (compact) {
    return (
      <Card
        className="group flex h-full cursor-pointer items-center gap-2.5 p-2.5 min-w-0 transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-border/70 hover:shadow-md"
        onClick={() => onOpenDetail(addon)}
      >
        <AddonLogo src={logo} name={name} className="h-9 w-9 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="truncate text-xs font-semibold tracking-tight">{name}</h3>
            {isRecentlyUpdated && updated && (
              <span className="inline-flex shrink-0 items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                {updated}
              </span>
            )}
          </div>
          <p className="truncate text-[11px] leading-snug text-muted-foreground">{description}</p>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <span className="flex items-center gap-0.5">
              <Star className="h-2.5 w-2.5 fill-warning text-warning" />
              {(addon.stars ?? 0).toLocaleString()}
            </span>
            {deployedOn > 0 && <span className="text-primary">· On {deployedOn}</span>}
            {saved && <span className="text-emerald-600 dark:text-emerald-400">· Saved</span>}
          </div>
        </div>
      </Card>
    )
  }

  return (
    <Card
      className="group flex h-full cursor-pointer flex-col gap-2.5 p-4 min-w-0 transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-border/70 hover:shadow-md"
      onClick={() => onOpenDetail(addon)}
    >
      <div className="flex shrink-0 items-start gap-3 min-w-0">
        <AddonLogo src={logo} name={name} className="h-11 w-11" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="truncate text-sm font-semibold tracking-tight">{name}</h3>
            <a
              href={addon.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="shrink-0 text-muted-foreground hover:text-foreground"
              aria-label="View on stremio-addons.net"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
          <div className="mt-0.5 flex items-center gap-x-2 overflow-hidden text-xs font-medium text-muted-foreground">
            <span className="flex shrink-0 items-center gap-1">
              <Star className="h-3 w-3 fill-warning text-warning" />
              {(addon.stars ?? 0).toLocaleString()}
            </span>
            {catalogCount > 0 && <span className="shrink-0">· {catalogCount} catalog{catalogCount !== 1 ? 's' : ''}</span>}
            {updated && (
              <span className={`truncate ${isRecentlyUpdated ? 'text-emerald-600 dark:text-emerald-400' : ''}`}>· {updated}</span>
            )}
          </div>
        </div>
      </div>

      <p className="min-h-9 shrink-0 text-xs leading-snug text-muted-foreground line-clamp-2">{description}</p>

      <div className="flex h-6 shrink-0 flex-nowrap items-center gap-1.5 overflow-hidden">
        {deployedOn > 0 && (
          <StatusChip className="shrink-0 gap-1 border-primary/30 bg-primary/10 text-primary">
            <Upload className="h-3 w-3" />
            On {deployedOn}
          </StatusChip>
        )}
        {needsConfig && (
          <StatusChip className="shrink-0 gap-1 text-warning">
            <Settings2 className="h-3 w-3" />
            Config
          </StatusChip>
        )}
        {resources.map((r) => (
          <StatusChip key={r} className="shrink-0">{RESOURCE_LABELS[r] ?? r}</StatusChip>
        ))}
        {types.slice(0, 3).map((t) => (
          <StatusChip key={t} className="shrink-0 capitalize text-muted-foreground/80">{t}</StatusChip>
        ))}
      </div>

      <div className="mt-auto space-y-1.5 pt-1" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        {/* Hub-native: deploying across your accounts is the primary action; library-save,
            favorite, configure and details are uniform equal-width secondary icons. */}
        <div className="flex gap-1.5">
          {onToggleFavorite && (
            <Tooltip content={favorite ? 'Favorited' : 'Favorite'} side="top">
              <Button
                size="sm"
                variant="outline"
                aria-label={favorite ? 'Remove favorite' : 'Favorite'}
                className="h-8 flex-1 bg-muted/40 text-foreground/70 shadow-none hover:bg-muted/70"
                onClick={() => onToggleFavorite(addon)}
              >
                {favorite ? <Heart className="h-3.5 w-3.5 fill-primary text-primary" /> : <Heart className="h-3.5 w-3.5" />}
              </Button>
            </Tooltip>
          )}

          <Tooltip content={saved ? 'In Library' : 'Save to Library'} side="top">
            <Button
              size="sm"
              variant="outline"
              aria-label={saved ? 'In Library' : 'Save to Library'}
              className="h-8 flex-1 bg-muted/40 text-foreground/70 shadow-none hover:bg-muted/70"
              onClick={() => onSave(addon)}
              disabled={saved || saving}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Plus className="h-3.5 w-3.5" />}
            </Button>
          </Tooltip>

          {!needsConfig && canConfigure && (
            <Tooltip content="Configure" side="top">
              <Button
                size="sm"
                variant="outline"
                aria-label="Configure"
                className="h-8 flex-1 bg-muted/40 text-foreground/70 shadow-none hover:bg-muted/70"
                onClick={() => onConfigure(addon)}
              >
                <Settings2 className="h-3.5 w-3.5" />
              </Button>
            </Tooltip>
          )}

          <Tooltip content="Details" side="top">
            <Button
              size="sm"
              variant="outline"
              aria-label="Details"
              className="h-8 flex-1 bg-muted/40 text-foreground/70 shadow-none hover:bg-muted/70"
              onClick={() => onOpenDetail(addon)}
            >
              <Info className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
        </div>

        {needsConfig && !saved ? (
          <Button size="sm" className="h-8 w-full gap-1.5 text-xs font-semibold" onClick={() => onConfigure(addon)}>
            <Settings2 className="h-3.5 w-3.5" />
            Configure to install
          </Button>
        ) : onAllAccounts ? (
          <Button size="sm" variant="outline" disabled className="h-8 w-full gap-1.5 bg-muted/40 text-xs font-semibold text-foreground/70 shadow-none">
            <Check className="h-3.5 w-3.5 text-emerald-500" />
            On all accounts
          </Button>
        ) : (
          <Button size="sm" className="h-8 w-full gap-1.5 text-xs font-semibold" onClick={() => onDeploy(addon)}>
            <Upload className="h-3.5 w-3.5" />
            {deployedOn > 0 ? 'Install on more' : 'Install to accounts'}
          </Button>
        )}
      </div>
    </Card>
  )
}

export const DiscoverCard = React.memo(
  DiscoverCardInner,
  (prev, next) =>
    prev.addon.uuid === next.addon.uuid
    && prev.addon.slug === next.addon.slug
    && prev.addon.url === next.addon.url
    && prev.addon.stars === next.addon.stars
    && prev.addon.updatedAt === next.addon.updatedAt
    && prev.addon.manifest?.name === next.addon.manifest?.name
    && prev.addon.manifest?.description === next.addon.manifest?.description
    && prev.addon.manifest?.logo === next.addon.manifest?.logo
    && prev.addon.manifest?.version === next.addon.manifest?.version
    && prev.saved === next.saved
    && prev.saving === next.saving
    && prev.favorite === next.favorite
    && prev.compact === next.compact
    && prev.accountTotal === next.accountTotal
    && (prev.deployedCount?.(prev.addon) ?? 0) === (next.deployedCount?.(next.addon) ?? 0)
)
