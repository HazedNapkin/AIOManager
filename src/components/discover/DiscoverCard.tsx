import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { StatusChip } from '@/components/ui/status-chip'
import { Bookmark, BookmarkCheck, Check, ExternalLink, Info, Loader2, Plus, Settings2, Star, Upload } from 'lucide-react'
import { getAddonResources, getConfigureUrl, lastUpdatedLabel, requiresConfiguration, RESOURCE_LABELS, type DiscoverAddon } from '@/api/discover'
import { AddonLogo } from './AddonLogo'

interface DiscoverCardProps {
  addon: DiscoverAddon
  saved: boolean
  saving: boolean
  favorite?: boolean
  onSave: (addon: DiscoverAddon) => void
  onDeploy: (addon: DiscoverAddon) => void
  onConfigure: (addon: DiscoverAddon) => void
  onOpenDetail: (addon: DiscoverAddon) => void
  onToggleFavorite?: (addon: DiscoverAddon) => void
}

export function DiscoverCard({ addon, saved, saving, favorite, onSave, onDeploy, onConfigure, onOpenDetail, onToggleFavorite }: DiscoverCardProps) {
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
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-medium text-muted-foreground">
            <span className="flex items-center gap-1">
              <Star className="h-3 w-3 fill-warning text-warning" />
              {(addon.stars ?? 0).toLocaleString()}
            </span>
            {catalogCount > 0 && <span>· {catalogCount} catalog{catalogCount !== 1 ? 's' : ''}</span>}
            {updated && <span className="truncate">· {updated}</span>}
          </div>
        </div>
      </div>

      <p className="min-h-9 shrink-0 text-xs leading-snug text-muted-foreground line-clamp-2">{description}</p>

      <div className="flex h-6 shrink-0 flex-nowrap items-center gap-1.5 overflow-hidden">
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

      <div className="mt-auto space-y-1.5 pt-1" onClick={(e) => e.stopPropagation()}>
        {/* Secondary actions grid */}
        <div className="grid grid-cols-2 gap-1.5">
          {/* Favorite */}
          {onToggleFavorite && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 bg-muted/40 text-xs font-semibold text-foreground/70 shadow-none hover:bg-muted/70"
              onClick={() => onToggleFavorite(addon)}
            >
              {favorite ? <BookmarkCheck className="h-3.5 w-3.5 text-primary" /> : <Bookmark className="h-3.5 w-3.5" />}
              Favorite
            </Button>
          )}

          {/* Save (when Configure is primary) */}
          {needsConfig && !saved && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 bg-muted/40 text-xs font-semibold text-foreground/70 shadow-none hover:bg-muted/70"
              onClick={() => onSave(addon)}
              disabled={saving}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Save
            </Button>
          )}

          {/* Configure (when not primary) */}
          {!needsConfig && canConfigure && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 bg-muted/40 text-xs font-semibold text-foreground/70 shadow-none hover:bg-muted/70"
              onClick={() => onConfigure(addon)}
            >
              <Settings2 className="h-3.5 w-3.5" />
              Configure
            </Button>
          )}

          {/* Install */}
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 bg-muted/40 text-xs font-semibold text-foreground/70 shadow-none hover:bg-muted/70"
            onClick={() => onDeploy(addon)}
          >
            <Upload className="h-3.5 w-3.5" />
            Install
          </Button>

          {/* Details */}
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 bg-muted/40 text-xs font-semibold text-foreground/70 shadow-none hover:bg-muted/70"
            onClick={() => onOpenDetail(addon)}
          >
            <Info className="h-3.5 w-3.5" />
            Details
          </Button>
        </div>

        {/* Primary action - Save/Configure (full width at bottom) */}
        {saved ? (
          <Button size="sm" variant="outline" disabled className="h-8 w-full gap-1.5 bg-muted/40 text-xs font-semibold text-foreground/70 shadow-none">
            <Check className="h-3.5 w-3.5" />
            In Library
          </Button>
        ) : needsConfig ? (
          <Button size="sm" className="h-8 w-full gap-1.5 text-xs font-semibold" onClick={() => onConfigure(addon)}>
            <Settings2 className="h-3.5 w-3.5" />
            Configure
          </Button>
        ) : (
          <Button size="sm" className="h-8 w-full gap-1.5 text-xs font-semibold" onClick={() => onSave(addon)} disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            {saving ? 'Saving…' : 'Save'}
          </Button>
        )}
      </div>
    </Card>
  )
}
