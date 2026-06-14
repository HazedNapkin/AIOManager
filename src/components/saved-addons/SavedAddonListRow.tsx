import type { SavedAddon, SavedAddonManifestChangeSummary } from '@/types/saved-addon'
import type { Account } from '@/types/account'
import { isNewerVersion, getAddonConfigureUrl, cn, getTimeAgo } from '@/lib/utils'
import { describeManifestChanges } from '@/lib/addon-manifest-diff'
import { useLongPress } from '@/hooks/useLongPress'
import { Copy, MoreVertical, Pencil, Check } from 'lucide-react'
import { Tooltip } from '@/components/ui/tooltip'
import { AnimatedSettingsIcon, AnimatedTrashIcon, AnimatedUpdateIcon } from '../ui/AnimatedIcons'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
    Dialog,
    DialogContent,
    DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { useAddonStore } from '@/store/addonStore'
import { useUIStore } from '@/store/uiStore'
import { useState, memo } from 'react'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { SavedAddonDetails } from './SavedAddonDetails'
import { getTagColor } from '@/lib/tag-utils'
import { Button } from '@/components/ui/button'
import { SavedAddonDeploymentBadge } from './SavedAddonDeploymentBadge'
import { SavedAddonIcon } from './SavedAddonIcon'
import { SourceUrlBox } from '@/components/addons/SourceUrlBox'
import type { AddonDescriptor } from '@/types/addon'

interface SavedAddonListRowProps {
    savedAddon: SavedAddon
    latestVersion?: string
    onUpdate?: (savedAddonId: string, addonName: string) => Promise<void>
    isSelectionMode?: boolean
    isSelected?: boolean
    onToggleSelect?: (id: string) => void
    onLongPress?: (id: string) => void
    profileName?: string
    deployedAccounts?: Account[]
    manifestChange?: SavedAddonManifestChangeSummary
}

export const SavedAddonListRow = memo(function SavedAddonListRow({
    savedAddon,
    latestVersion,
    onUpdate,
    isSelectionMode,
    isSelected,
    onToggleSelect,
    onLongPress,
    profileName,
    deployedAccounts = [],
    manifestChange,
}: SavedAddonListRowProps) {
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

    const handleCopyUrl = (e: React.MouseEvent) => {
        e.stopPropagation()
        navigator.clipboard.writeText(savedAddon.installUrl)
        toast({ title: 'URL Copied', description: 'Addon install URL copied to clipboard' })
    }

    const handleOpenConfiguration = (e: React.MouseEvent) => {
        e.stopPropagation()
        const configUrl = getAddonConfigureUrl(savedAddon.installUrl)
        window.open(configUrl, '_blank', 'noopener,noreferrer')
    }

    const handleConfirmDelete = async () => {
        try {
            await deleteSavedAddon(savedAddon.id)
            setShowDeleteDialog(false)
        } catch (error) {
            if (import.meta.env.DEV) console.error('Failed to delete saved addon:', error)
        }
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

    const getHealthTooltip = () => {
        if (!savedAddon.health) return 'Health not checked'
        const status = savedAddon.health.isOnline ? 'Online' : 'Offline'
        const error = savedAddon.health.error ? ` (${savedAddon.health.error})` : ''
        return `${status}${error}`
    }

    const { isLongPressTriggered, ...longPressProps } = useLongPress(() => {
        if (!isSelectionMode && onLongPress) {
            onLongPress(savedAddon.id)
        }
    })

    const logo = savedAddon.metadata?.customLogo || savedAddon.manifest.logo

    return (
        <>
            <div
                {...longPressProps}
                className={cn(
                    "group flex items-center gap-2 px-3 py-3 rounded-2xl border transition-[transform,opacity,box-shadow] duration-150 sm:gap-3 sm:px-4",
                    isSelected
                        ? "bg-primary/5 border-primary/30 shadow-[inset_3px_0_0_hsl(var(--primary))]"
                        : "bg-card border-border/40 hover:border-border/70 hover:shadow-md",
                    isSelectionMode && "cursor-pointer"
                )}
                onClick={() => {
                    if (isLongPressTriggered) return
                    if (isSelectionMode && onToggleSelect) onToggleSelect(savedAddon.id)
                }}
            >
                {isSelectionMode && (
                    <div className={cn(
                        "shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors",
                        isSelected ? "bg-primary border-primary" : "border-border/40"
                    )}>
                        {isSelected && <Check className="w-3 h-3 text-white" />}
                    </div>
                )}


                <div className="relative w-9 h-9 shrink-0">
                    <SavedAddonIcon
                        name={savedAddon.name}
                        logo={logo}
                        alt={savedAddon.name}
                        className="h-full w-full"
                        textClassName="text-sm"
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


                <div className="flex-1 min-w-0">

                    <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-semibold truncate">{savedAddon.name}</span>
                        <span className="hidden text-xs text-muted-foreground/60 shrink-0 min-[380px]:inline">v{savedAddon.manifest.version}</span>
                        {hasManifestShapeChange && (
                            <Tooltip content={manifestChangeLabel || 'Manifest catalogs or resources changed'} side="top">
                                <span className="inline-flex rounded-full border border-warning/25 bg-warning/10 px-1.5 text-xs font-bold uppercase leading-5 text-warning">
                                    Manifest
                                </span>
                            </Tooltip>
                        )}
                        {hasUpdate && onUpdate && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleUpdate}
                                disabled={updating}
                                className="h-5 px-1.5 py-0 text-xs font-bold uppercase bg-warning/10 text-warning border border-warning/30 hover:bg-warning/20 hover:text-warning gap-1 shrink-0"
                            >
                                <AnimatedUpdateIcon className="h-2.5 w-2.5" isAnimating={updating} />
                                {updating ? '...' : hasVersionUpdate ? 'Update' : 'Refresh'}
                            </Button>
                        )}
                    </div>


                    <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground/60 min-w-0">
                        <SourceUrlBox
                            url={savedAddon.installUrl}
                            manifest={savedAddon.manifest}
                            privacyMode={isPrivacyModeEnabled}
                            variant="compact"
                            disabled={updating}
                            onReplace={handleReplaceUrl}
                            successDescription="Library entry, installed copies, and Autopilot rules were updated."
                            className="max-w-[180px] shrink basis-[150px] py-0.5 sm:max-w-[260px] sm:basis-[220px]"
                        />
                        {savedAddon.tags.length > 0 && (
                            <>
                                <span className="hidden shrink-0 sm:inline">·</span>
                                <div
                                    className="hidden items-center gap-1 min-w-0 overflow-hidden sm:flex"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    {savedAddon.tags.slice(0, 2).map((tag) => {
                                        const color = getTagColor(tag)
                                        return (
                                            <span
                                                key={tag}
                                                className="text-xs pointer-events-none px-1.5 py-0 rounded-full shrink-0 leading-5 font-medium"
                                                style={{ background: color.bg, color: color.text, border: `1px solid ${color.border}` }}
                                            >
                                                {tag}
                                            </span>
                                        )
                                    })}
                                    {savedAddon.tags.length > 2 && (
                                        <span className="text-xs text-muted-foreground/60 shrink-0">+{savedAddon.tags.length - 2}</span>
                                    )}
                                </div>
                            </>
                        )}
                        {profileName && (
                            <>
                                <span className="hidden shrink-0 sm:inline">·</span>
                                <span className="hidden truncate text-foreground/60 sm:inline">{profileName}</span>
                            </>
                        )}
                        {deployedAccounts.length > 0 && (
                            <>
                                <span className="hidden shrink-0 sm:inline">·</span>
                                <SavedAddonDeploymentBadge accounts={deployedAccounts} className="hidden sm:inline-flex" />
                            </>
                        )}
                        <span className="hidden shrink-0 min-[380px]:inline">·</span>
                        <span className="hidden shrink-0 min-[380px]:inline">Saved {getTimeAgo(new Date(savedAddon.createdAt))}</span>
                    </div>
                </div>

                <div className="shrink-0">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={(e) => e.stopPropagation()}
                                className="h-7 w-7 flex items-center justify-center text-muted-foreground hover:text-foreground"
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
                            <DropdownMenuItem onClick={() => setShowDetails(true)} className="gap-2">
                                <Pencil className="h-4 w-4" />
                                Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem destructive onClick={() => setShowDeleteDialog(true)} className="gap-2 text-destructive focus:text-destructive">
                                <AnimatedTrashIcon className="h-4 w-4" />
                                Delete
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>

            <Dialog open={showDetails} onOpenChange={setShowDetails}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto overflow-x-hidden">
                    <DialogTitle className="sr-only">Edit {savedAddon.name}</DialogTitle>
                    <SavedAddonDetails savedAddon={savedAddon} onClose={() => setShowDetails(false)} />
                </DialogContent>
            </Dialog>

            <ConfirmationDialog
                open={showDeleteDialog}
                onOpenChange={setShowDeleteDialog}
                title="Delete Saved Addon?"
                description="This will NOT remove it from accounts where it's already installed."
                confirmText="Delete"
                isDestructive={true}
                onConfirm={handleConfirmDelete}
            />
        </>
    )
})
