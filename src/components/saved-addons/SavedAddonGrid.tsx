import { StaggerContainer, StaggerItem } from '@/components/ui/stagger'
import { Button } from '@/components/ui/button'
import { StatusChip } from '@/components/ui/status-chip'
import { cn, getLatestAddonVersion } from '@/lib/utils'
import type { SavedAddon, SavedAddonManifestChangeSummary } from '@/types/saved-addon'
import type { Profile } from '@/types/profile'
import { ChevronDown, Package, User } from 'lucide-react'
import { SavedAddonCard } from './SavedAddonCard'
import { SavedAddonListRow } from './SavedAddonListRow'
import type { SavedAddonDeploymentSummary } from './hooks/useSavedAddonLibraryData'

interface SavedAddonGridProps {
  addons: SavedAddon[]
  profiles: Profile[]
  selectedProfileId: string | null
  collapsedProfiles: Set<string>
  onToggleProfile: (id: string) => void
  viewMode: 'grid' | 'list'
  latestVersions: Record<string, string>
  manifestChangeHints: Record<string, SavedAddonManifestChangeSummary>
  deploymentSummaryByAddonId: Record<string, SavedAddonDeploymentSummary>
  onUpdate: (savedAddonId: string, addonName: string) => Promise<void>
  isSelectionMode: boolean
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onEnterSelectionMode: () => void
  highlight?: string
}

const EMPTY_DEPLOYED_ACCOUNTS: SavedAddonDeploymentSummary['deployedAccounts'] = []

export function SavedAddonGrid({
  addons,
  profiles,
  selectedProfileId,
  collapsedProfiles,
  onToggleProfile,
  viewMode,
  latestVersions,
  manifestChangeHints,
  deploymentSummaryByAddonId,
  onUpdate,
  isSelectionMode,
  selectedIds,
  onToggleSelect,
  onEnterSelectionMode,
  highlight,
}: SavedAddonGridProps) {
  const renderAddon = (addon: SavedAddon, profileName?: string, showHighlight = false) => {
    const onLongPress = (id: string) => {
      onEnterSelectionMode()
      onToggleSelect(id)
    }

    if (viewMode === 'list') {
      return (
        <StaggerItem key={addon.id}>
          <SavedAddonListRow
            savedAddon={addon}
            latestVersion={getLatestAddonVersion(latestVersions, {
              transportUrl: addon.installUrl,
              manifest: addon.manifest,
            })}
            manifestChange={manifestChangeHints[addon.id]}
            onUpdate={onUpdate}
            isSelectionMode={isSelectionMode}
            isSelected={selectedIds.has(addon.id)}
            onToggleSelect={onToggleSelect}
            onLongPress={onLongPress}
            profileName={profileName}
            deployedAccounts={deploymentSummaryByAddonId[addon.id]?.deployedAccounts ?? EMPTY_DEPLOYED_ACCOUNTS}
          />
        </StaggerItem>
      )
    }

    return (
      <StaggerItem key={addon.id}>
        <SavedAddonCard
          savedAddon={addon}
          latestVersion={getLatestAddonVersion(latestVersions, {
            transportUrl: addon.installUrl,
            manifest: addon.manifest,
          })}
          manifestChange={manifestChangeHints[addon.id]}
          onUpdate={onUpdate}
          isSelectionMode={isSelectionMode}
          isSelected={selectedIds.has(addon.id)}
          onToggleSelect={onToggleSelect}
          onLongPress={onLongPress}
          profileName={profileName}
          deployedAccounts={deploymentSummaryByAddonId[addon.id]?.deployedAccounts ?? EMPTY_DEPLOYED_ACCOUNTS}
          highlight={showHighlight ? highlight : undefined}
        />
      </StaggerItem>
    )
  }

  if (selectedProfileId !== null) {
    return (
      <StaggerContainer className={cn(
        viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4' : 'w-full flex flex-col gap-2'
      )}>
        {addons.map((addon) => {
          const profile = profiles.find(p => p.id === addon.profileId)
          return renderAddon(addon, profile?.name, true)
        })}
      </StaggerContainer>
    )
  }

  return (
    <div className="space-y-4 w-full">
      {profiles.map(profile => {
        const profileAddons = addons.filter(a => a.profileId === profile.id)
        if (profileAddons.length === 0) return null
        const isExpanded = !collapsedProfiles.has(profile.id)

        return (
          <div key={profile.id} className="rounded-2xl border border-border/40 bg-card/50 p-3 space-y-3 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <Button
                variant="ghost"
                ripple={false}
                className="h-auto justify-start flex items-center gap-2.5 px-2 py-1 rounded-full group hover:bg-muted/50 transition-[transform,opacity,box-shadow] [&_svg]:!size-3.5"
                onClick={() => onToggleProfile(profile.id)}
              >
                <ChevronDown className={cn(
                  'h-3.5 w-3.5 text-foreground/60 transition-transform shrink-0',
                  collapsedProfiles.has(profile.id) && '-rotate-90'
                )} />
                <span className="text-sm font-semibold text-foreground/70 group-hover:text-foreground transition-colors flex items-center gap-2">
                  <User className="h-3.5 w-3.5 shrink-0" />
                  {profile.name}
                </span>
              </Button>
              <StatusChip variant="muted">
                {profileAddons.length} addon{profileAddons.length !== 1 ? 's' : ''}
              </StatusChip>
            </div>

            {isExpanded && (
              <StaggerContainer className={cn(
                viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3' : 'w-full flex flex-col gap-2'
              )}>
                {profileAddons.map((addon) => renderAddon(addon, profile.name))}
              </StaggerContainer>
            )}
          </div>
        )
      })}

      {(() => {
        const unassigned = addons.filter(a => !a.profileId || !profiles.some(p => p.id === a.profileId))
        if (unassigned.length === 0) return null
        const isExpanded = !collapsedProfiles.has('unassigned')

        return (
          <div className="rounded-2xl border border-border/40 bg-card/50 p-3 space-y-3 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <Button
                variant="ghost"
                ripple={false}
                className="h-auto justify-start flex items-center gap-2.5 px-2 py-1 rounded-full group hover:bg-muted/50 transition-[transform,opacity,box-shadow] [&_svg]:!size-3.5"
                onClick={() => onToggleProfile('unassigned')}
              >
                <ChevronDown className={cn(
                  'h-3.5 w-3.5 text-foreground/60 transition-transform shrink-0',
                  collapsedProfiles.has('unassigned') && '-rotate-90'
                )} />
                <span className="text-sm font-semibold text-foreground/60 group-hover:text-foreground/80 transition-colors flex items-center gap-2">
                  <Package className="h-3.5 w-3.5 shrink-0" />
                  Unassigned
                </span>
              </Button>
              <StatusChip variant="muted">
                {unassigned.length} addon{unassigned.length !== 1 ? 's' : ''}
              </StatusChip>
            </div>

            {isExpanded && (
              <StaggerContainer className={cn(
                viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3' : 'flex flex-col gap-2'
              )}>
                {unassigned.map((addon) => renderAddon(addon))}
              </StaggerContainer>
            )}
          </div>
        )
      })()}
    </div>
  )
}
