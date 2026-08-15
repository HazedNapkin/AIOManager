import { useState } from 'react'
import { useAddonStore } from '@/store/addonStore'
import { useToast } from '@/hooks/use-toast'
import { isNewerVersion, getTimeAgo } from '@/lib/utils'
import { describeManifestChanges } from '@/lib/addon-manifest-diff'
import type { SavedAddon, SavedAddonManifestChangeSummary } from '@/types/saved-addon'
import type { AddonDescriptor } from '@/types/addon'

interface SavedAddonActionsOptions {
    savedAddon: SavedAddon
    latestVersion?: string
    manifestChange?: SavedAddonManifestChangeSummary
    onUpdate?: (savedAddonId: string, addonName: string) => Promise<void>
}

export function useSavedAddonActions({ savedAddon, latestVersion, manifestChange, onUpdate }: SavedAddonActionsOptions) {
    const deleteSavedAddon = useAddonStore(s => s.deleteSavedAddon)
    const replaceTransportUrlUniversally = useAddonStore(s => s.replaceTransportUrlUniversally)
    const { toast } = useToast()

    const [showDetails, setShowDetails] = useState(false)
    const [showDeleteDialog, setShowDeleteDialog] = useState(false)
    const [updating, setUpdating] = useState(false)

    const hasVersionUpdate = latestVersion ? isNewerVersion(savedAddon.manifest.version, latestVersion) : false
    const hasManifestShapeChange = !!manifestChange?.hasManifestShapeChange
    const hasUpdate = hasVersionUpdate || hasManifestShapeChange
    const manifestChangeLabel = manifestChange ? describeManifestChanges(manifestChange) : ''

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
        const lastChecked = new Date(savedAddon.health.lastChecked)
        const timeAgo = getTimeAgo(lastChecked)
        return `${status}${error}\nLast checked: ${timeAgo}`
    }

    return {
        showDetails,
        setShowDetails,
        showDeleteDialog,
        setShowDeleteDialog,
        updating,
        hasUpdate,
        hasVersionUpdate,
        hasManifestShapeChange,
        manifestChangeLabel,
        handleConfirmDelete,
        handleCopyUrl,
        handleUpdate,
        handleReplaceUrl,
        getHealthTooltip,
    }
}
