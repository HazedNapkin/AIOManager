import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip } from '@/components/ui/tooltip'
import { ToolbarShell } from '@/components/ui/toolbar-shell'
import { cn } from '@/lib/utils'
import { LayoutGrid, Rows3, Search, SlidersHorizontal, Sparkles, Star, X } from 'lucide-react'
import { RESOURCE_LABELS, type DiscoverCategory, type DiscoverSortBy } from '@/api/discover'

// Refine facets applied client-side to the loaded results (the public directory API does not
// support resource/type query params), so they narrow what's already fetched.
const RESOURCE_FACETS = ['stream', 'catalog', 'meta', 'subtitles', 'addon_catalog'] as const
const TYPE_FACETS = ['movie', 'series', 'anime', 'tv'] as const

interface DiscoverToolbarProps {
  search: string
  onSearchChange: (value: string) => void
  sortBy: DiscoverSortBy
  onSortByChange: (value: DiscoverSortBy) => void
  categories: DiscoverCategory[]
  selectedCategories: string[]
  onToggleCategory: (slug: string) => void
  selectedResources: string[]
  onToggleResource: (resource: string) => void
  selectedTypes: string[]
  onToggleType: (type: string) => void
  showAdult: boolean
  onToggleAdult: () => void
  showSort?: boolean
  compact?: boolean
  onToggleCompact?: () => void
}

function FacetChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-primary bg-primary/15 text-primary'
          : 'border-border/40 bg-muted/30 text-muted-foreground hover:text-foreground hover:bg-muted/50'
      )}
    >
      {children}
    </button>
  )
}

export function DiscoverToolbar({
  search,
  onSearchChange,
  sortBy,
  onSortByChange,
  categories,
  selectedCategories,
  onToggleCategory,
  selectedResources,
  onToggleResource,
  selectedTypes,
  onToggleType,
  showAdult,
  onToggleAdult,
  showSort = true,
  compact,
  onToggleCompact,
}: DiscoverToolbarProps) {
  const activeFilterCount = selectedResources.length + selectedTypes.length
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement
      const isInput = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if (e.key === '/' && !isInput) {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  return (
    <div className="flex flex-col gap-2">
      <ToolbarShell contentClassName="w-full gap-2 sm:gap-3">
        <div className="relative flex-1 min-w-0 sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            ref={searchRef}
            placeholder="Search community addons..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9 pr-9 h-8 text-xs bg-muted/30 border border-border/40 focus:bg-muted/40 transition-colors"
          />
          {search && (
            <Button
              variant="ghost"
              size="icon"
              ripple={false}
              onClick={() => onSearchChange('')}
              className="absolute right-2 top-1/2 h-7 w-7 flex items-center justify-center -translate-y-1/2 p-0 hover:bg-accent rounded-full transition-colors"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap sm:ml-auto sm:flex-nowrap sm:shrink-0">
          {showSort && (
            <div className="flex items-center bg-muted/50 rounded-xl p-0.5 border border-border/40 gap-0.5">
              <Button
                variant="ghost"
                size="sm"
                className={cn('h-7 gap-1.5 rounded-lg px-2.5 text-xs', sortBy === 'stars' ? 'bg-background shadow-sm text-foreground hover:bg-background' : 'text-muted-foreground hover:text-foreground')}
                onClick={() => onSortByChange('stars')}
              >
                <Star className="h-3.5 w-3.5" />
                Top
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={cn('h-7 gap-1.5 rounded-lg px-2.5 text-xs', sortBy === 'createdAt' ? 'bg-background shadow-sm text-foreground hover:bg-background' : 'text-muted-foreground hover:text-foreground')}
                onClick={() => onSortByChange('createdAt')}
              >
                <Sparkles className="h-3.5 w-3.5" />
                New
              </Button>
            </div>
          )}

          {showSort && onToggleCompact && (
            <div className="flex items-center bg-muted/50 rounded-xl p-0.5 border border-border/40 gap-0.5">
              <Tooltip content="Grid view" side="bottom">
              <Button
                variant="ghost"
                size="sm"
                ripple={false}
                aria-label="Grid view"
                className={cn('h-7 rounded-lg px-2', !compact ? 'bg-background shadow-sm text-foreground hover:bg-background' : 'text-muted-foreground hover:text-foreground')}
                onClick={() => { if (compact) onToggleCompact() }}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </Button>
              </Tooltip>
              <Tooltip content="Compact view" side="bottom">
              <Button
                variant="ghost"
                size="sm"
                ripple={false}
                aria-label="Compact view"
                className={cn('h-7 rounded-lg px-2', compact ? 'bg-background shadow-sm text-foreground hover:bg-background' : 'text-muted-foreground hover:text-foreground')}
                onClick={() => { if (!compact) onToggleCompact() }}
              >
                <Rows3 className="h-3.5 w-3.5" />
              </Button>
              </Tooltip>
            </div>
          )}

          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant={activeFilterCount > 0 ? 'secondary' : 'outline'}
                size="sm"
                className="h-8 gap-1.5 text-xs"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Filters{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ''}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 space-y-4">
              <div className="space-y-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">Resource</p>
                <div className="flex flex-wrap gap-1.5">
                  {RESOURCE_FACETS.map((r) => (
                    <FacetChip key={r} active={selectedResources.includes(r)} onClick={() => onToggleResource(r)}>
                      {RESOURCE_LABELS[r] ?? r}
                    </FacetChip>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">Type</p>
                <div className="flex flex-wrap gap-1.5">
                  {TYPE_FACETS.map((t) => (
                    <FacetChip key={t} active={selectedTypes.includes(t)} onClick={() => onToggleType(t)}>
                      <span className="capitalize">{t}</span>
                    </FacetChip>
                  ))}
                </div>
              </div>
              {activeFilterCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full h-7 text-xs text-muted-foreground"
                  onClick={() => {
                    selectedResources.forEach(r => onToggleResource(r))
                    selectedTypes.forEach(t => onToggleType(t))
                  }}
                >
                  Clear all filters
                </Button>
              )}
            </PopoverContent>
          </Popover>

          <Button
            variant={showAdult ? 'secondary' : 'outline'}
            size="sm"
            className="h-8 text-xs font-medium px-2.5"
            onClick={onToggleAdult}
          >
            {showAdult ? 'Adult: on' : 'Adult: off'}
          </Button>
        </div>
      </ToolbarShell>

      {categories.length > 0 && (
        <div className="flex overflow-x-auto gap-1.5 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {categories.map((c) => {
            const active = selectedCategories.includes(c.slug)
            return (
              <button
                key={c.slug}
                type="button"
                onClick={() => onToggleCategory(c.slug)}
                className={cn(
                  'shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                  active
                    ? 'border-primary bg-primary/15 text-primary'
                    : 'border-border/40 bg-muted/30 text-muted-foreground hover:text-foreground hover:bg-muted/50'
                )}
              >
                {c.name}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
