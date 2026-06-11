import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { normalizeTagName } from '@/lib/addon-validator'
import { useAddonStore } from '@/store/addonStore'
import { useUIStore } from '@/store/uiStore'
import { Switch } from '@/components/ui/switch'
import { AddonIcon } from '@/components/ui/addon-icon'
import { SavedAddon } from '@/types/saved-addon'
import { useState } from 'react'
import { useToast } from '@/hooks/use-toast'
import { SourceUrlBox } from '@/components/addons/SourceUrlBox'
import type { AddonDescriptor } from '@/types/addon'

export function SavedAddonDetails({ savedAddon, onClose }: { savedAddon: SavedAddon, onClose: () => void }) {
  const updateSavedAddon = useAddonStore(s => s.updateSavedAddon)
  const updateSavedAddonMetadata = useAddonStore(s => s.updateSavedAddonMetadata)
  const replaceTransportUrlUniversally = useAddonStore(s => s.replaceTransportUrlUniversally)
  const loading = useAddonStore(s => s.loading)
  const error = useAddonStore(s => s.error)
  const isPrivacyModeEnabled = useUIStore((state) => state.isPrivacyModeEnabled)
  const { toast } = useToast()

  const [formData, setFormData] = useState({
    name: savedAddon.name,
    tags: savedAddon.tags.join(', '),
    customLogo: savedAddon.metadata?.customLogo || '',
    customDescription: savedAddon.metadata?.customDescription || '',
    syncWithInstalled: savedAddon.syncWithInstalled ?? false,
  })

  const [formError, setFormError] = useState<string | null>(null)

  const hasChanges =
    formData.name !== savedAddon.name ||
    formData.tags !== savedAddon.tags.join(', ') ||
    formData.customLogo !== (savedAddon.metadata?.customLogo || '') ||
    formData.customDescription !== (savedAddon.metadata?.customDescription || '') ||
    formData.syncWithInstalled !== (savedAddon.syncWithInstalled ?? false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)

    try {
      // Parse tags
      const tags = formData.tags
        .split(/[,\s]+/)
        .map((t) => normalizeTagName(t))
        .filter(Boolean)

      const name = formData.name.trim()

      await updateSavedAddon(savedAddon.id, {
        name,
        tags,
        syncWithInstalled: formData.syncWithInstalled,
        metadata: {
          customName: name,
          customLogo: formData.customLogo.trim() || undefined,
          customDescription: formData.customDescription.trim() || undefined
        }
      })

      onClose()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to update saved addon')
    }
  }

  const handleReplaceUrl = async (descriptor: AddonDescriptor, requestedUrl: string) => {
    setFormError(null)
    return replaceTransportUrlUniversally(savedAddon.id, savedAddon.installUrl, descriptor.transportUrl || requestedUrl, undefined, descriptor)
  }

  return (
    <div className="space-y-6 min-w-0 overflow-hidden">
      {(formError || error) && (
        <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20">
          <p className="text-sm text-destructive">{formError || error}</p>
        </div>
      )}


      <form onSubmit={handleSubmit} className="space-y-4 min-w-0 overflow-hidden">
        <SourceUrlBox
          url={savedAddon.installUrl}
          manifest={savedAddon.manifest}
          privacyMode={isPrivacyModeEnabled}
          variant="full"
          onReplace={handleReplaceUrl}
          successDescription="Library entry, installed copies, and Autopilot rules were updated."
        />


        <div className="space-y-2">
          <Label htmlFor="edit-name">Saved Addon Name</Label>
          <Input
            id="edit-name"
            type="text"
            value={formData.name}
            onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
            maxLength={100}
            required
          />
        </div>


        <div className="space-y-2">
          <Label htmlFor="edit-tags">Tags</Label>
          <Input
            id="edit-tags"
            type="text"
            value={formData.tags}
            onChange={(e) => setFormData((prev) => ({ ...prev, tags: e.target.value }))}
            placeholder="e.g., essential, torrent, debrid"
          />
        </div>



        <div className="space-y-2">
          <Label htmlFor="edit-logo">Custom Logo URL</Label>
          <Input
            id="edit-logo"
            type="text"
            value={formData.customLogo}
            onChange={(e) => setFormData((prev) => ({ ...prev, customLogo: e.target.value }))}
            placeholder="https://... (Leave empty for default)"
          />
        </div>


        <div className="space-y-2">
          <Label htmlFor="edit-description">Custom Description</Label>
          <textarea
            id="edit-description"
            className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            value={formData.customDescription}
            onChange={(e) => setFormData((prev) => ({ ...prev, customDescription: e.target.value }))}
            placeholder={savedAddon.manifest.description}
          />
        </div>

        <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30 gap-3">
          <div className="space-y-0.5 flex-1 min-w-0">
            <Label htmlFor="sync-with-installed" className="text-sm font-semibold block truncate">Keep in sync with installed versions</Label>
            <p className="text-xs text-muted-foreground uppercase tracking-tight break-words">
              When enabled, changing this addon's URL or metadata in the library will automatically update it across all accounts where it is installed.
            </p>
          </div>
          <div className="flex-shrink-0">
            <Switch
              id="sync-with-installed"
              checked={formData.syncWithInstalled}
              onCheckedChange={(checked) => setFormData(prev => ({ ...prev, syncWithInstalled: checked }))}
            />
          </div>
        </div>


        <div className="space-y-2">
          <Label>Addon Info</Label>
          <div className="flex items-start gap-3">
            <AddonIcon
              name={formData.name || savedAddon.manifest.name}
              logo={formData.customLogo || savedAddon.manifest.logo}
              alt={savedAddon.manifest.name}
              className="h-12 w-12"
              textClassName="text-lg"
            />
            <div className="text-sm space-y-1 overflow-hidden min-w-0">
              <p className="truncate" title={savedAddon.manifest.name}>
                <span className="font-medium">Name:</span> {savedAddon.manifest.name}
              </p>
              <p className="break-all">
                <span className="font-medium">ID:</span>{' '}
                {isPrivacyModeEnabled ? '********' : savedAddon.manifest.id}
              </p>
              <p className="truncate" title={savedAddon.manifest.version}>
                <span className="font-medium">Version:</span> {savedAddon.manifest.version}
              </p>
            </div>
          </div>
        </div>


        <div className="space-y-2">
          <Label>Metadata</Label>
          <div className="text-sm text-muted-foreground space-y-1">
            <p>Created: {new Date(savedAddon.createdAt).toLocaleString()}</p>
            <p>Updated: {new Date(savedAddon.updatedAt).toLocaleString()}</p>
            {savedAddon.lastUsed && (
              <p>Last used: {new Date(savedAddon.lastUsed).toLocaleString()}</p>
            )}
            <p>Source: {savedAddon.sourceType === 'manual' ? 'Manual' : 'Cloned from account'}</p>
          </div>
        </div>


        <div className="flex justify-end gap-2 pt-4">
          <Button
            type="button"
            variant="subtle"
            className="mr-auto"
            disabled={loading}
            onClick={async () => {
              try {
                // Fetch the original manifest from the addon URL
                const { fetchAddonManifest } = await import('@/api/addons')
                const fetched = await fetchAddonManifest(savedAddon.installUrl)
                const originalManifest = fetched.manifest

                await updateSavedAddonMetadata(savedAddon.id, {
                  customName: undefined,
                  customLogo: undefined,
                  customDescription: undefined
                })
                await updateSavedAddon(savedAddon.id, {
                  name: originalManifest.name || savedAddon.manifest.name
                })

                setFormData(prev => ({
                  ...prev,
                  name: originalManifest.name || savedAddon.manifest.name,
                  customLogo: '',
                  customDescription: ''
                }))

                toast({
                  title: 'Reset Complete',
                  description: `Restored original manifest values for "${originalManifest.name}".`,
                })
              } catch (err) {
                if (import.meta.env.DEV) console.error('Reset failed:', err)
                // Fallback: reset using stored manifest values
                await updateSavedAddonMetadata(savedAddon.id, {
                  customName: undefined,
                  customLogo: undefined,
                  customDescription: undefined
                })
                await updateSavedAddon(savedAddon.id, {
                  name: savedAddon.manifest.name
                })
                setFormData(prev => ({
                  ...prev,
                  name: savedAddon.manifest.name,
                  customLogo: '',
                  customDescription: ''
                }))
                toast({
                  title: 'Reset Complete',
                  description: 'Reset to stored defaults (could not reach addon server).',
                })
              }
            }}
          >
            Reset to Defaults
          </Button>
          <Button type="submit" disabled={loading || !hasChanges}>
            {loading ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </form>
    </div>
  )
}
