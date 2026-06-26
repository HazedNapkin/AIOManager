import { type ReactNode, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { Profile } from '@/types/profile'
import { GripVertical, Layers, Package, Plus, User } from 'lucide-react'
import { ProfileDialog } from '../profiles/ProfileDialog'
import { ProfileReorderDialog } from '../profiles/ProfileReorderDialog'
import { AnimatedSettingsIcon } from '../ui/AnimatedIcons'

interface LibrarySidebarProps {
  profiles: Profile[]
  selectedProfileId: string | null
  onSelectProfile: (id: string | null) => void
  savedAddonCount: number
  unassignedCount: number
  profileAddonCounts: Record<string, number>
  allTags: string[]
  selectedTag: string | null
  onSelectTag: (tag: string | null) => void
  tagCounts: Record<string, number>
  showMobileFilters: boolean
  onCloseMobileFilters: () => void
  onManageTags: () => void
  onDeleteProfile: (id: string) => void
}

interface FilterButtonProps {
  active: boolean
  label: string
  count?: number
  showCount?: boolean
  icon?: ReactNode
  className?: string
  onClick: () => void
}

function FilterButton({
  active,
  label,
  count,
  showCount = true,
  icon,
  className,
  onClick,
}: FilterButtonProps) {
  return (
    <Button
      variant="ghost"
      ripple={false}
      className={cn(
        'relative h-auto w-full justify-start gap-2.5 rounded-xl border px-2.5 py-2 text-left text-sm font-medium transition-colors [&_svg]:!size-3.5',
        active
          ? 'border-border/45 bg-background text-foreground shadow-sm hover:bg-background hover:text-foreground'
          : 'border-transparent text-muted-foreground hover:border-border/35 hover:bg-muted/45 hover:text-foreground',
        className
      )}
      onClick={onClick}
    >
      {icon}
      <span className="flex-1 truncate">{label}</span>
      {showCount && typeof count === 'number' && (
        <span className={cn(
          'text-xs font-bold tabular-nums shrink-0',
          active ? 'text-foreground/70' : 'text-foreground/60'
        )}>
          {count}
        </span>
      )}
    </Button>
  )
}

export function LibrarySidebar({
  profiles,
  selectedProfileId,
  onSelectProfile,
  savedAddonCount,
  unassignedCount,
  profileAddonCounts,
  allTags,
  selectedTag,
  onSelectTag,
  tagCounts,
  showMobileFilters,
  onCloseMobileFilters,
  onManageTags,
  onDeleteProfile,
}: LibrarySidebarProps) {
  const [showProfileReorderDialog, setShowProfileReorderDialog] = useState(false)

  const handleMobileProfileSelect = (id: string | null) => {
    onSelectProfile(id)
    onCloseMobileFilters()
  }

  const handleMobileTagSelect = (tag: string | null) => {
    onSelectTag(tag)
    onCloseMobileFilters()
  }

  const renderProfileFilters = (mobile = false) => (
    <>
      <FilterButton
        active={selectedProfileId === null}
        label="All Addons"
        count={savedAddonCount}
        icon={<Layers className="shrink-0" />}
        onClick={() => mobile ? handleMobileProfileSelect(null) : onSelectProfile(null)}
      />
      <FilterButton
        active={selectedProfileId === 'unassigned'}
        label="Unassigned"
        count={unassignedCount}
        showCount={unassignedCount > 0}
        icon={<Package className="shrink-0" />}
        onClick={() => mobile ? handleMobileProfileSelect('unassigned') : onSelectProfile('unassigned')}
      />
      {mobile && profiles.map(profile => (
          <FilterButton
            key={profile.id}
            active={selectedProfileId === profile.id}
            label={profile.name}
            count={profileAddonCounts[profile.id] || 0}
            showCount={(profileAddonCounts[profile.id] || 0) > 0}
            icon={<User className="shrink-0" />}
            className="min-w-0"
            onClick={() => handleMobileProfileSelect(profile.id)}
          />
      ))}
    </>
  )

  const renderTagFilters = (mobile = false) => (
    <>
      <FilterButton
        active={selectedTag === null}
        label="All tags"
        count={savedAddonCount}
        onClick={() => mobile ? handleMobileTagSelect(null) : onSelectTag(null)}
      />
      {allTags.map(tag => {
        const count = tagCounts[tag] || 0
        if (count === 0) return null
        return (
          <FilterButton
            key={tag}
            active={selectedTag === tag}
            label={tag}
            count={count}
            onClick={() => {
              const nextTag = selectedTag === tag ? null : tag
              if (mobile) handleMobileTagSelect(nextTag)
              else onSelectTag(nextTag)
            }}
          />
        )
      })}
    </>
  )

  return (
    <>
      <div className="hidden md:block md:w-[260px] flex-shrink-0">
        <div className="flex max-h-[calc(100vh-14rem)] flex-col overflow-hidden rounded-2xl border border-border/40 bg-card p-2.5 shadow-sm">
          <div className="shrink-0 space-y-1">
            <div className="mb-1 flex items-center justify-between px-2 py-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Profiles</span>
              <div className="flex items-center gap-1">
                <Tooltip content="Reorder Profiles">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 flex items-center justify-center text-muted-foreground hover:text-foreground"
                    onClick={() => setShowProfileReorderDialog(true)}
                    disabled={profiles.length === 0}
                    aria-label="Reorder profiles"
                  >
                    <GripVertical className="h-3.5 w-3.5" />
                  </Button>
                </Tooltip>
                <ProfileDialog trigger={
                  <Tooltip content="Create Profile">
                    <Button variant="ghost" size="icon" className="h-6 w-6 flex items-center justify-center text-muted-foreground hover:text-foreground" aria-label="Create profile">
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </Tooltip>
                } />
              </div>
            </div>

            <ProfileReorderDialog
              open={showProfileReorderDialog}
              onOpenChange={setShowProfileReorderDialog}
            />

            {renderProfileFilters(false)}
          </div>

          {profiles.length > 0 && (
            <div className="mt-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto border-t border-border/35 pt-2 pr-0.5 custom-scrollbar">
              {profiles.map(profile => (
                  <div key={profile.id} className="group flex items-center gap-1">
                    <FilterButton
                      active={selectedProfileId === profile.id}
                      label={profile.name}
                      count={profileAddonCounts[profile.id] || 0}
                      showCount={(profileAddonCounts[profile.id] || 0) > 0}
                      icon={<User className="shrink-0" />}
                      className="flex-1 min-w-0"
                      onClick={() => onSelectProfile(profile.id)}
                    />
                    <div className="flex shrink-0 items-center">
                      <ProfileDialog
                        profile={profile}
                        onDelete={onDeleteProfile}
                        trigger={
                           <Button variant="ghost" size="icon" className="h-6 w-6 flex items-center justify-center text-muted-foreground hover:text-foreground" aria-label="Edit profile">
                            <AnimatedSettingsIcon className="h-3 w-3" />
                          </Button>
                        }
                      />
                    </div>
                  </div>
                ))}
            </div>
          )}

          {allTags.length > 0 && (
            <div className="mt-3 shrink-0 space-y-1 border-t border-border/35 pt-3">
              <div className="mb-1 flex items-center justify-between px-2 py-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tags</span>
                <Tooltip content="Manage Tags">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 flex items-center justify-center text-muted-foreground hover:text-foreground"
                    onClick={onManageTags}
                    aria-label="Manage tags"
                  >
                    <AnimatedSettingsIcon className="h-3.5 w-3.5" />
                  </Button>
                </Tooltip>
              </div>
              {renderTagFilters(false)}
            </div>
          )}
        </div>
      </div>

      {showMobileFilters && (
        <div className="flex md:hidden flex-col gap-3">
          <div className="space-y-1 rounded-[1.75rem] border border-border/45 bg-card/80 p-3 shadow-sm">
            <div className="mb-1 flex items-center justify-between px-2 py-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Profiles</span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 flex items-center justify-center text-muted-foreground hover:text-foreground"
                  onClick={() => setShowProfileReorderDialog(true)}
                  disabled={profiles.length === 0}
                  aria-label="Reorder profiles"
                >
                  <GripVertical className="h-3.5 w-3.5" />
                </Button>
                <ProfileDialog trigger={
                  <Button variant="ghost" size="icon" className="h-6 w-6 flex items-center justify-center text-muted-foreground hover:text-foreground" aria-label="Create profile">
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                } />
              </div>
            </div>
            {renderProfileFilters(true)}
            {profiles.length > 0 && (
              <div className="mt-1 space-y-0.5 border-t border-border/30 pt-1">
                {profiles.map(profile => (
                  <div key={profile.id} className="flex items-center gap-1">
                    <span className="flex-1 truncate px-2 py-1 text-xs text-muted-foreground">{profile.name}</span>
                    <ProfileDialog
                      profile={profile}
                      onDelete={onDeleteProfile}
                      trigger={
                        <Button variant="ghost" size="icon" className="h-6 w-6 flex items-center justify-center text-muted-foreground hover:text-foreground" aria-label="Edit profile">
                          <AnimatedSettingsIcon className="h-3 w-3" />
                        </Button>
                      }
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
          {allTags.length > 0 && (
            <div className="space-y-1 rounded-[1.75rem] border border-border/45 bg-card/80 p-3 shadow-sm">
              <div className="mb-1 flex items-center justify-between px-2 py-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tags</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 flex items-center justify-center text-muted-foreground hover:text-foreground"
                  onClick={onManageTags}
                  aria-label="Manage tags"
                >
                  <AnimatedSettingsIcon className="h-3.5 w-3.5" />
                </Button>
              </div>
              {renderTagFilters(true)}
            </div>
          )}
        </div>
      )}
    </>
  )
}
