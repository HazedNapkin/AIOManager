import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip } from '@/components/ui/tooltip'
import { ToolbarShell } from '@/components/ui/toolbar-shell'
import { AnimatedRefreshIcon, AnimatedUpdateIcon } from '@/components/ui/AnimatedIcons'
import { cn } from '@/lib/utils'
import { Check, Grid, List, Plus, Search, SlidersHorizontal, Wand2, X } from 'lucide-react'
import type { Profile } from '@/types/profile'

interface LibraryToolbarProps {
  showMobileFilters: boolean
  selectedProfileId: string | null
  selectedTag: string | null
  profiles: Profile[]
  searchQuery: string
  onSearchChange: (value: string) => void
  viewMode: 'grid' | 'list'
  onViewModeChange: (mode: 'grid' | 'list') => void
  savedAddonsCount: number
  healthSummary: { online: number; offline: number }
  checkingUpdates: boolean
  checkingHealth: boolean
  updatingAll: boolean
  updatesCount: number
  onRefresh: () => void
  onUpdateAll: () => void
  onOpenBulkUrlReplace: () => void
  isSelectionMode: boolean
  onToggleSelectionMode: () => void
  onOpenAddDialog: () => void
  onToggleMobileFilters: () => void
}

export function LibraryToolbar({
  showMobileFilters,
  selectedProfileId,
  selectedTag,
  profiles,
  searchQuery,
  onSearchChange,
  viewMode,
  onViewModeChange,
  savedAddonsCount,
  healthSummary,
  checkingUpdates,
  checkingHealth,
  updatingAll,
  updatesCount,
  onRefresh,
  onUpdateAll,
  onOpenBulkUrlReplace,
  isSelectionMode,
  onToggleSelectionMode,
  onOpenAddDialog,
  onToggleMobileFilters,
}: LibraryToolbarProps) {
  const searchPlaceholder = (() => {
    if (!selectedProfileId) return 'Search by name, tags, or URL...'
    if (selectedProfileId === 'unassigned') return 'Search unassigned addons...'
    const profile = profiles.find(p => p.id === selectedProfileId)
    if (!profile) return 'Search...'
    const possessive = profile.name.endsWith('s') ? `${profile.name}'` : `${profile.name}'s`
    return `Search ${possessive} addons...`
  })()

  return (
    <ToolbarShell contentClassName="w-full gap-2 sm:gap-3">
        <div className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-2 sm:flex sm:w-auto sm:flex-none">
          <Button
            variant={showMobileFilters || selectedProfileId !== null || selectedTag !== null ? 'secondary' : 'outline'}
            size="sm"
            className="h-8 gap-1.5 shrink-0 md:hidden text-xs font-medium"
            onClick={onToggleMobileFilters}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Filters
            {(selectedProfileId !== null || selectedTag !== null) && (
              <span className="w-4 h-4 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
                {(selectedProfileId !== null ? 1 : 0) + (selectedTag !== null ? 1 : 0)}
              </span>
            )}
          </Button>

          <div className="relative flex-1 sm:w-72 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder={searchPlaceholder}
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-9 pr-9 h-8 text-xs bg-muted/30 border border-border/40 focus:bg-muted/40 transition-colors"
            />
            {searchQuery && (
              <Button
                variant="ghost"
                size="icon"
                ripple={false}
                onClick={() => onSearchChange('')}
                className="absolute right-2 top-1/2 h-7 w-7 -translate-y-1/2 p-0 hover:bg-accent rounded-full transition-colors"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            )}
          </div>

          <div className="flex items-center bg-muted/50 rounded-lg p-0.5 border border-border/40 gap-0.5 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className={cn('h-8 w-8 rounded-lg p-0', viewMode === 'grid' ? 'bg-background shadow-sm text-foreground hover:bg-background' : 'text-muted-foreground hover:text-foreground')}
              onClick={() => onViewModeChange('grid')}
              aria-label="Grid view"
            >
              <Grid className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn('h-8 w-8 rounded-lg p-0', viewMode === 'list' ? 'bg-background shadow-sm text-foreground hover:bg-background' : 'text-muted-foreground hover:text-foreground')}
              onClick={() => onViewModeChange('list')}
              aria-label="List view"
            >
              <List className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto sm:justify-end">
          {savedAddonsCount > 0 && (
            <div className="hidden sm:flex items-center gap-2 px-2.5 h-8 rounded-md bg-muted/40 border border-border/40 text-xs font-medium text-muted-foreground shrink-0">
              <Tooltip content={`${healthSummary.online} online`} side="top">
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-success" />
                  {healthSummary.online}
                </span>
              </Tooltip>
              {healthSummary.offline > 0 && (
                <Tooltip content={`${healthSummary.offline} offline`} side="top">
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-destructive" />
                    {healthSummary.offline}
                  </span>
                </Tooltip>
              )}
            </div>
          )}

            <Button
            size="sm"
            variant="outline"
            className="h-9 w-full shrink-0 gap-1.5 text-xs font-medium sm:h-8 sm:w-auto"
            onClick={onRefresh}
            disabled={checkingUpdates || checkingHealth || updatingAll || savedAddonsCount === 0}
          >
            <AnimatedRefreshIcon className="h-3.5 w-3.5" isAnimating={checkingUpdates || checkingHealth} />
            <span>{(checkingUpdates || checkingHealth) ? 'Checking...' : 'Refresh'}</span>
          </Button>

          {updatesCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="order-first col-span-full h-9 w-full shrink-0 gap-1.5 text-xs font-medium sm:order-none sm:col-span-auto sm:h-8 sm:w-auto"
              onClick={onUpdateAll}
              disabled={updatingAll}
            >
              <AnimatedUpdateIcon className="h-3.5 w-3.5" isAnimating={updatingAll} />
              <span>{`Update All (${updatesCount})`}</span>
            </Button>
          )}

          <Tooltip content="Find and replace text in install URLs across your library (e.g. domain or token migrations)" side="bottom">
            <Button
              size="sm"
              variant="outline"
              className="h-9 w-full shrink-0 gap-1.5 text-xs font-medium sm:h-8 sm:w-auto"
              onClick={onOpenBulkUrlReplace}
            >
              <Wand2 className="h-3.5 w-3.5" />
              <span className="sm:hidden">Replace</span>
              <span className="hidden sm:inline">Replace URL</span>
            </Button>
          </Tooltip>

          <Button
            size="sm"
            variant="outline"
            className="h-9 w-full shrink-0 gap-1.5 text-xs font-medium sm:h-8 sm:w-auto"
            onClick={onToggleSelectionMode}
          >
            {isSelectionMode ? <X className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
            <span>{isSelectionMode ? 'Cancel' : 'Select'}</span>
          </Button>

          <Button
            size="sm"
            className="h-9 w-full shrink-0 gap-1.5 text-xs font-medium sm:h-8 sm:w-auto"
            onClick={onOpenAddDialog}
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="sm:hidden">Add</span>
            <span className="hidden sm:inline">Add Addon</span>
          </Button>
        </div>
    </ToolbarShell>
  )
}
