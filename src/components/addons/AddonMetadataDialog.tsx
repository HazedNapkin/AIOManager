import { Button } from '@/components/ui/button'
import { ImageUploadButton } from '@/components/ui/image-upload-button'
import { Tooltip } from '@/components/ui/tooltip'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Upload } from 'lucide-react'
import { AddonIcon } from '@/components/ui/addon-icon'
import { AddonDescriptor } from '@/types/addon'
import { useEffect, useState } from 'react'
import { useUIStore } from '@/store/uiStore'
import { useAccountStore } from '@/store/accountStore'
import { SourceUrlBox } from './SourceUrlBox'
import { ManifestJSONEditor } from './ManifestJSONEditor'

interface AddonMetadataDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    addon: AddonDescriptor
    accountId: string
    onSave: (metadata: { customName?: string; customLogo?: string; customDescription?: string }) => Promise<void>
    onReplaceUrl?: (newUrl: string, descriptor?: AddonDescriptor) => Promise<{ failedAccounts?: string[] } | void>
}

export function AddonMetadataDialog({
    open,
    onOpenChange,
    addon,
    accountId,
    onSave,
    onReplaceUrl,
}: AddonMetadataDialogProps) {
    const [customName, setCustomName] = useState('')
    const [customLogo, setCustomLogo] = useState('')
    const [customDescription, setCustomDescription] = useState('')
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const isPrivacyModeEnabled = useUIStore((state) => state.isPrivacyModeEnabled)

    const hasChanges =
        customName !== (addon.metadata?.customName || '') ||
        customLogo !== (addon.metadata?.customLogo || '') ||
        customDescription !== (addon.metadata?.customDescription || '')


    useEffect(() => {
        if (open) {
            setCustomName(addon.metadata?.customName || '')
            setCustomLogo(addon.metadata?.customLogo || '')
            setCustomDescription(addon.metadata?.customDescription || '')
            setError(null)
        }
    }, [open, addon])

    const handleSave = async () => {
        setSaving(true)
        setError(null)
        try {
            await onSave({
                customName: customName.trim() || undefined,
                customLogo: customLogo.trim() || undefined,
                customDescription: customDescription.trim() || undefined,
            })
            onOpenChange(false)
        } catch (err) {
            if (import.meta.env.DEV) console.error(err)
            setError('Failed to save changes.')
        } finally {
            setSaving(false)
        }
    }

    const handleReset = async () => {
        setSaving(true)
        setError(null)
        try {
            // Clear all custom overrides by sending undefined
            await onSave({
                customName: undefined,
                customLogo: undefined,
                customDescription: undefined,
            })
            setCustomName('')
            setCustomLogo('')
            setCustomDescription('')
            onOpenChange(false) // Close dialog so parent re-renders with fresh addon data
        } catch (err) {
            if (import.meta.env.DEV) console.error(err)
            setError('Failed to reset defaults.')
        } finally {
            setSaving(false)
        }
    }

    const handleReplaceUrl = async (descriptor: AddonDescriptor, requestedUrl: string) => {
        if (!onReplaceUrl) return
        setError(null)
        try {
            const result = await onReplaceUrl(descriptor.transportUrl || requestedUrl, descriptor)
            if (!result?.failedAccounts?.length) onOpenChange(false)
            return result
        } catch (err) {
            const message = (err instanceof Error && err.message) || 'Failed to replace URL.'
            setError(message)
            throw new Error(message)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>Edit Addon Details</DialogTitle>
                    <DialogDescription>
                        Customize how this addon appears in your Stremio dashboard.
                    </DialogDescription>
                </DialogHeader>

                <div className="md:grid md:grid-cols-2 gap-6 py-4">
                    <div className="space-y-4">

                        <div className="space-y-2">
                            <Label htmlFor="name">Display Name</Label>
                            <div className="flex gap-2">
                                <Input
                                    id="name"
                                    value={customName}
                                    onChange={(e) => setCustomName(e.target.value)}
                                    placeholder={addon.manifest.name}
                                />
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setCustomName('')}
                                    disabled={!customName}
                                    className="text-xs text-muted-foreground shrink-0"
                                >
                                    Reset
                                </Button>
                            </div>
                        </div>


                        <div className="space-y-2">
                            <Label htmlFor="logo">Logo URL</Label>
                            <div className="flex gap-2">
                                <Input
                                    id="logo"
                                    value={customLogo.startsWith('data:') ? '\u2713 Uploaded image' : customLogo}
                                    onChange={(e) => setCustomLogo(e.target.value)}
                                    placeholder="https://..."
                                    readOnly={customLogo.startsWith('data:')}
                                />
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setCustomLogo('')}
                                    disabled={!customLogo}
                                    className="text-xs text-muted-foreground shrink-0"
                                >
                                    Reset
                                </Button>
                            </div>
                            <ImageUploadButton
                                onUploaded={setCustomLogo}
                                options={{ maxDimension: 512, square: false, quality: 0.85 }}
                                className="flex h-8 w-fit items-center gap-1.5 rounded-md border border-border/40 px-3 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
                            >
                                <Upload className="h-3 w-3" /> Upload Image
                            </ImageUploadButton>
                        </div>


                        <div className="space-y-2">
                            <Label htmlFor="description">Description</Label>
                            <div className="flex gap-2">
                                <Textarea
                                    id="description"
                                    value={customDescription}
                                    onChange={(e) => setCustomDescription(e.target.value)}
                                    placeholder={addon.manifest.description}
                                />
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setCustomDescription('')}
                                    disabled={!customDescription}
                                    className="text-xs text-muted-foreground shrink-0 mt-1"
                                >
                                    Reset
                                </Button>
                            </div>
                        </div>




                        {error && <p className="text-sm text-destructive font-medium">{error}</p>}
                    </div>

                    <div className="space-y-4 pt-4 md:pt-0">

                        <div className="border rounded-md p-4 bg-muted/20 flex flex-col items-center justify-start gap-4 h-full min-h-[250px] overflow-hidden">
                            <span className="text-xs font-medium text-muted-foreground uppercase">Dashboard Preview</span>

                            <div className="flex flex-col items-center gap-3 w-full">
                                <AddonIcon
                                    name={customName || addon.manifest.name}
                                    logo={customLogo || addon.manifest.logo}
                                    alt="Logo Preview"
                                    className="h-16 w-16 sm:h-20 sm:w-20"
                                    textClassName="text-2xl"
                                />
                                <span className="font-bold text-base sm:text-lg text-center break-words w-full px-2 line-clamp-2">
                                    {customName || addon.manifest.name}
                                </span>
                                <div className="w-full text-center px-2 sm:px-4">
                                    <p className="text-xs text-muted-foreground line-clamp-4 sm:line-clamp-6 leading-relaxed italic break-words">
                                        {customDescription || addon.manifest.description}
                                    </p>
                                </div>
                                <span className="text-xs text-muted-foreground px-2 py-1 bg-muted rounded-full mt-2 shrink-0">
                                    v{addon.manifest.version}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>


                <div className="bg-muted/50 -mx-6 px-6 py-4 mt-2 border-t text-xs text-muted-foreground grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <span className="font-semibold block mb-1">Developer Info</span>
                        <p className="break-all line-clamp-2">ID: {addon.manifest.id}</p>
                        <p className="break-words line-clamp-2">Name: {addon.manifest.name}</p>
                    </div>
                    <div>
                        <span className="font-semibold block mb-1">Technical Details</span>
                        {onReplaceUrl ? (
                            <SourceUrlBox
                                addon={addon}
                                accountId={accountId}
                                privacyMode={isPrivacyModeEnabled}
                                variant="compact"
                                onReplace={handleReplaceUrl}
                                successDescription="Addon URL updated successfully."
                                className="mt-1 bg-background/45"
                            />
                        ) : (
                            <Tooltip content={addon.transportUrl}>
                                <p className="break-all line-clamp-2">URL: {isPrivacyModeEnabled ? '********' : addon.transportUrl}</p>
                            </Tooltip>
                        )}
                        <p>Status: {addon.flags?.protected ? 'Protected' : 'Standard'}</p>
                    </div>
                </div>

                <ManifestJSONEditor
                    manifest={addon.manifest}
                    onSave={async (newManifest) => {
                        await useAccountStore.getState().updateAddonSettings(
                            accountId,
                            addon.transportUrl,
                            { manifest: newManifest }
                        )
                        onOpenChange(false)
                    }}
                />

                <div className="mt-4 flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between [&_button]:h-11 [&_button]:w-full [&_button]:rounded-full [&_button]:px-5 sm:[&_button]:w-auto">
                    <Button type="button" variant="subtle" onClick={handleReset} disabled={saving}>
                        Reset Details
                    </Button>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                        <Button variant="subtle" onClick={() => onOpenChange(false)} disabled={saving}>
                            Cancel
                        </Button>
                        <Button onClick={handleSave} disabled={saving || !hasChanges}>
                            {saving ? 'Syncing...' : 'Save & Sync'}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
