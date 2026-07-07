import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useLongPress } from '@/hooks/useLongPress'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useToast } from '@/hooks/use-toast'
import { cn, getAddonConfigureUrl, isNewerVersion, getTimeAgo } from '@/lib/utils'
import { describeManifestChanges } from '@/lib/addon-manifest-diff'
import { useAddonStore } from '@/store/addonStore'
import { useUIStore } from '@/store/uiStore'
import { Button } from '@/components/ui/button'
import { StatusChip } from '@/components/ui/status-chip'
import { ArrowUpCircle, Copy, Link2, MoreVertical, Pencil, Send } from 'lucide-react'
import { AnimatedSettingsIcon, AnimatedTrashIcon, AnimatedUpdateIcon } from '../ui/AnimatedIcons'
import { restorationManager } from '@/lib/autopilot/restorationManager'

import React, { useState } from 'react'
import type { SavedAddon, SavedAddonManifestChangeSummary } from '@/types/saved-addon'
import type { Account } from '@/types/account'
import { SavedAddonDetails } from './SavedAddonDetails'
import { getTagColor } from '@/lib/tag-utils'
import { HighlightText } from '@/components/ui/highlight-text'
import { Tooltip } from '@/components/ui/tooltip'
import { SavedAddonDeploymentBadge } from './SavedAddonDeploymentBadge'
import { SavedAddonIcon } from './SavedAddonIcon'
import { SourceUrlBox } from '@/components/addons/SourceUrlBox'
import type { AddonDescriptor } from '@/types/addon'

interface SavedAddonCardProps {
  savedAddon: SavedAddon
  latestVersion?: string
  onUpdate?: (savedAddonId: string, addonName: string) => Promise<void>
  onDeploy?: (savedAddonId: string) => void
  isSelectionMode?: boolean
  isSelected?: boolean
  onToggleSelect?: (id: string) => void
  onLongPress?: (id: string) => void
  profileName?: string
  deployedAccounts?: Account[]
  highlight?: string
  manifestChange?: SavedAddonManifestChangeSummary
}

export const SavedAddonCard = React.memo(function SavedAddonCard({
  savedAddon,
  latestVersion,
  onUpdate,
  onDeploy,
  isSelectionMode,
  isSelected,
  onToggleSelect,
  onLongPress,
  profileName,
  deployedAccounts = [],
  highlight = '',
  manifestChange,
}: SavedAddonCardProps) {
  const deleteSavedAddon = useAddonStore(s => s.deleteSavedAddon)
  const replaceTransportUrlUniversally = useAddonStore(s => s.replaceTransportUrlUniversally)
  const isPrivacyModeEnabled = useUIStore((state) => state.isPrivacyModeEnabled)
  const { toast } = useToast()
  const [showDetails, setShowDetails] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [updating, setUpdating] = useState(false)

  const hasVersionUpdate = latestVersion ? isNewerVersion(savedAddon.manifest.version, latestVersion) : false
  const hasManifestShapeChange = !!manifestChange?.hasManifestShapeChange
  const hasUpdate = hasVersionUpdate || hasManifestShapeChange
  const manifestChangeLabel = manifestChange ? describeManifestChanges(manifestChange) : ''

  const handleDelete = () => {
    setShowDeleteDialog(true)
  }

  const handleConfirmDelete = async () => {
    try {
      await deleteSavedAddon(savedAddon.id)
      setShowDeleteDialog(false)
    } catch (error) {
      if (import.meta.env.DEV) console.error('Failed to delete saved addon:', error)
    }
  }

  const handleCopyUrl = (e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(savedAddon.installUrl)
    toast({
      title: 'URL Copied',
      description: 'Addon install URL copied to clipboard',
    })
  }

  const handleOpenConfiguration = (e: React.MouseEvent) => {
    e.stopPropagation()
    const configUrl = getAddonConfigureUrl(savedAddon.installUrl)
    window.open(configUrl, '_blank', 'noopener,noreferrer')
  }

  const getHealthTooltip = () => {
    if (!savedAddon.health) {
      return 'Health not checked'
    }
    const status = savedAddon.health.isOnline ? 'Online' : 'Offline'
    const error = savedAddon.health.error ? ` (${savedAddon.health.error})` : ''
    const lastChecked = new Date(savedAddon.health.lastChecked)
    const timeAgo = getTimeAgo(lastChecked)
    return `${status}${error}\nLast checked: ${timeAgo}`
  }

  const handleUpdate = async (e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (!onUpdate) return
    setUpdating(true)
    try {
      await onUpdate(savedAddon.id, savedAddon.name)
    } finally {
      setUpdating(false)
    }
  }

  const handleReplaceUrl = async (descriptor: AddonDescriptor, requestedUrl: string) => {
    return replaceTransportUrlUniversally(savedAddon.id, savedAddon.installUrl, descriptor.transportUrl || requestedUrl, undefined, descriptor)
  }

  const { isLongPressTriggered, ...longPressProps } = useLongPress(() => {
    if (!isSelectionMode && onLongPress) {
      onLongPress(savedAddon.id)
    }
  })

  const handleCardActivate = () => {
    if (isLongPressTriggered) return
    if (isSelectionMode && onToggleSelect) {
      onToggleSelect(savedAddon.id)
    }
  }

  return (
    <>
      <div
        {...longPressProps}
        role={isSelectionMode ? "button" : undefined}
        tabIndex={isSelectionMode ? 0 : undefined}
        className={cn(
          "group flex flex-col h-full relative rounded-2xl p-3 sm:p-5 border transition-[transform,opacity,box-shadow] duration-200",
          isSelectionMode ? "cursor-pointer" : "",
          isSelected
            ? "bg-primary/12 border-primary/25 shadow-[0_0_15px_hsla(var(--primary)/0.2)]"
            : "bg-card border-border/40 hover:border-border/80 shadow-sm"
        )}
        onClick={() => {
          if (isLongPressTriggered) return
          if (isSelectionMode && onToggleSelect) {
            onToggleSelect(savedAddon.id)
          }
        }}
        onKeyDown={isSelectionMode ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCardActivate() } } : undefined}
      >
        {isSelected && (
          <div className="absolute -top-2 -right-2 z-10 w-6 h-6 rounded-full flex items-center justify-center border-2 border-background shadow-lg bg-primary">
            <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )}

        <div className={isSelectionMode ? 'pointer-events-none flex flex-col flex-1 h-full' : 'flex flex-col flex-1 h-full'}>
          <div className="flex items-start justify-between pb-4">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="relative w-11 h-11 shrink-0">
                <SavedAddonIcon
                  name={savedAddon.name}
                  logo={savedAddon.metadata?.customLogo || savedAddon.manifest.logo}
                  alt={savedAddon.name}
                  className="h-full w-full"
                  textClassName="text-lg text-foreground"
                />
                <Tooltip content={getHealthTooltip()} side="top">
                  <span
                    className={cn(
                      "absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-card z-20",
                      savedAddon.health
                        ? savedAddon.health.isOnline
                          ? "bg-success animate-pulse"
                          : "bg-destructive"
                        : "bg-muted-foreground/60"
                    )}
                  />
                </Tooltip>
              </div>

              <div className="flex flex-col min-w-0 pr-2">
                <div className="truncate leading-tight flex items-center gap-2 text-base font-semibold">
                  <HighlightText text={savedAddon.name} highlight={highlight} />
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-0.5 overflow-hidden">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-xs text-muted-foreground/70">
                      v{savedAddon.manifest.version}
                    </span>

                    {(savedAddon.manifest.behaviorHints?.configurable || savedAddon.manifest.behaviorHints?.configurationRequired) && (
                      <Tooltip content="Configure">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={handleOpenConfiguration}
                          className="ml-1 h-5 w-5 text-muted-foreground hover:text-foreground"
                          aria-label="Configure"
                        >
                          <AnimatedSettingsIcon className="h-3 w-3" />
                        </Button>
                      </Tooltip>
                    )}
                  </div>

                  {savedAddon.syncWithInstalled && (
                    hasUpdate ? (
                      <Tooltip content={manifestChangeLabel || 'A newer version is available to push to your installed accounts'}>
                        <StatusChip variant="warning" icon={<ArrowUpCircle />}>Update ready</StatusChip>
                      </Tooltip>
                    ) : (
                      <Tooltip content="In sync with your installed accounts">
                        <StatusChip variant="success" icon={<Link2 />}>In Sync</StatusChip>
                      </Tooltip>
                    )
                  )}
                  {savedAddon.sourceType === 'cloned-from-account' && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium uppercase bg-primary/12 text-primary border border-primary/25">
                      Cloned
                    </span>
                  )}
                  {hasManifestShapeChange && (
                    <Tooltip content={manifestChangeLabel || 'Manifest catalogs or resources changed'}>
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium uppercase bg-warning/10 text-warning border border-warning/25">
                        Manifest
                      </span>
                    </Tooltip>
                  )}
                  {(() => {
                    const status = restorationManager.getStatus(savedAddon.installUrl)
                    if (status.status === 'restoring') {
                      return (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium uppercase bg-warning/10 text-warning border border-warning/20 animate-pulse">
                          Restoring...
                        </span>
                      )
                    }
                    if (status.circuitState === 'open') {
                      return (
                        <Tooltip content="Auto-restore disabled after repeated failures. 30m cooldown.">
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium uppercase bg-destructive/10 text-destructive border border-destructive/20">
                            Failed
                          </span>
                        </Tooltip>
                      )
                    }
                    return null
                  })()}
                </div>
              </div>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => e.stopPropagation()}
                  className="shrink-0 -mr-2 h-7 w-7 flex items-center justify-center text-muted-foreground hover:text-foreground"
                  aria-label="More options"
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={4} collisionPadding={8} className="w-56 max-w-[calc(100vw-2rem)]">
                <div className="px-2 py-1.5 text-xs font-medium uppercase text-muted-foreground">Manage Saved Addon</div>
                <DropdownMenuItem onClick={handleCopyUrl} className="gap-2">
                  <Copy className="h-4 w-4" />
                  Copy URL
                </DropdownMenuItem>
                {(savedAddon.manifest.behaviorHints?.configurable || savedAddon.manifest.behaviorHints?.configurationRequired) && (
                  <DropdownMenuItem onClick={handleOpenConfiguration} className="gap-2">
                    <AnimatedSettingsIcon className="h-4 w-4" />
                    Configure
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => onDeploy?.(savedAddon.id)} className="gap-2">
                  <Send className="h-4 w-4" />
                  Deploy
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowDetails(true)} className="gap-2">
                  <Pencil className="h-4 w-4" />
                  Customize
                </DropdownMenuItem>
                <DropdownMenuItem destructive onClick={handleDelete} className="gap-2 text-destructive focus:text-destructive">
                  <AnimatedTrashIcon className="h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="flex-grow flex flex-col min-w-0 pt-2">
            {((savedAddon.metadata?.customDescription || (savedAddon.manifest.description && savedAddon.manifest.description !== `Addon generated by ${savedAddon.name}`))) && (
              <div className="line-clamp-2 mb-3 text-xs text-muted-foreground leading-relaxed">
                {savedAddon.metadata?.customDescription || savedAddon.manifest.description}
              </div>
            )}

            <SourceUrlBox
              url={savedAddon.installUrl}
              manifest={savedAddon.manifest}
              privacyMode={isPrivacyModeEnabled}
              variant="compact"
              disabled={updating}
              onReplace={handleReplaceUrl}
              successDescription="Library entry, installed copies, and Autopilot rules were updated."
              className="mb-2"
            />


            <div className="flex-grow" />

            <div className="flex flex-wrap gap-1 relative z-20 mt-auto pt-2" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
              {hasUpdate && onUpdate && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleUpdate}
                  disabled={updating}
                  className="h-5 px-2 gap-0.5 text-xs font-bold uppercase bg-primary/12 text-primary border border-primary/25 hover:bg-primary/20 hover:text-primary shrink-0"
                >
                  {updating ? 'Updating...' : <><AnimatedUpdateIcon className="h-3 w-3" isAnimating={updating} /> {hasVersionUpdate ? 'Update' : 'Refresh'}</>}
                </Button>
              )}
              {savedAddon.tags.map((tag) => {
                const color = getTagColor(tag)
                return (
                  <span
                    key={tag}
                    className="text-xs pointer-events-none px-1.5 py-0 rounded-full leading-5 font-medium"
                    style={{
                      background: color.bg,
                      color: color.text,
                      border: `1px solid ${color.border}`
                    }}
                  >
                    {tag}
                  </span>
                )
              })}
            </div>

            <div className="flex items-center justify-between gap-2 pt-3 mt-2">
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                {profileName && (
                  <span className="text-xs text-foreground/60 whitespace-normal break-words line-clamp-2">
                    {profileName}
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <SavedAddonDeploymentBadge accounts={deployedAccounts} />
                {savedAddon.createdAt && (
                  <span className="text-xs text-muted-foreground/60 tabular-nums shrink-0">
                    Added {getTimeAgo(new Date(savedAddon.createdAt))}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <Dialog open={showDetails} onOpenChange={setShowDetails}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto overflow-x-hidden">
          <DialogHeader>
            <DialogTitle>Edit Saved Addon</DialogTitle>
            <DialogDescription>
              Customize how this saved addon appears and where it lives in your library.
            </DialogDescription>
          </DialogHeader>
          <SavedAddonDetails savedAddon={savedAddon} deployedAccounts={deployedAccounts} onClose={() => setShowDetails(false)} />
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        title="Delete Saved Addon?"
        description={
          <>
            <p>Are you sure you want to delete "{savedAddon.name}"?</p>
            <p className="font-semibold">
              This will NOT remove it from accounts where it's already installed.
            </p>
          </>
        }
        confirmText="Delete"
        isDestructive={true}
        onConfirm={handleConfirmDelete}
      />
    </>
  )
})
