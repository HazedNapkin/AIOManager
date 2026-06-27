import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { normalizeTagName } from '@/lib/addon-validator'
import { useAddonStore } from '@/store/addonStore'
import { useProfileStore } from '@/store/profileStore'
import { useUIStore } from '@/store/uiStore'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AddonIcon } from '@/components/ui/addon-icon'
import { SavedAddon } from '@/types/saved-addon'
import type { Account } from '@/types/account'
import { useState } from 'react'
import { useToast } from '@/hooks/use-toast'
import { SourceUrlBox } from '@/components/addons/SourceUrlBox'
import type { AddonDescriptor } from '@/types/addon'

export function SavedAddonDetails({ savedAddon, deployedAccounts = [], onClose }: { savedAddon: SavedAddon; deployedAccounts?: Account[]; onClose: () => void }) {
  const updateSavedAddon = useAddonStore(s => s.updateSavedAddon)
  const updateSavedAddonMetadata = useAddonStore(s => s.updateSavedAddonMetadata)
  const replaceTransportUrlUniversally = useAddonStore(s => s.replaceTransportUrlUniversally)
  const loading = useAddonStore(s => s.loading)
  const error = useAddonStore(s => s.error)
  const profiles = useProfileStore(s => s.profiles)
  const isPrivacyModeEnabled = useUIStore((state) => state.isPrivacyModeEnabled)
  const { toast } = useToast()

  const currentProfileId = savedAddon.profileId ?? 'unassigned'

  const [formData, setFormData] = useState({
    name: savedAddon.name,
    tags: savedAddon.tags.join(', '),
    customLogo: savedAddon.metadata?.customLogo || '',
    customDescription: savedAddon.metadata?.customDescription || '',
    syncWithInstalled: savedAddon.syncWithInstalled ?? false,
    profileId: currentProfileId,
  })

  const [formError, setFormError] = useState<string | null>(null)

  const hasChanges =
    formData.name !== savedAddon.name ||
    formData.tags !== savedAddon.tags.join(', ') ||
    formData.customLogo !== (savedAddon.metadata?.customLogo || '') ||
    formData.customDescription !== (savedAddon.metadata?.customDescription || '') ||
    formData.syncWithInstalled !== (savedAddon.syncWithInstalled ?? false) ||
    formData.profileId !== currentProfileId

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)

    try {
      const tags = formData.tags
        .split(/[,\s]+/)
        .map((t) => normalizeTagName(t))
        .filter(Boolean)

      const name = formData.name.trim()

      await updateSavedAddon(savedAddon.id, {
        name,
        tags,
        syncWithInstalled: formData.syncWithInstalled,
        profileId: formData.profileId === 'unassigned' ? null : formData.profileId,
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

  const handleResetDefaults = async () => {
    try {
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
  }

  return (
    <form onSubmit={handleSubmit} className="min-w-0">
      {(formError || error) && (
        <div className="mb-4 rounded-md border border-destructive/20 bg-destructive/10 p-3">
          <p className="text-sm text-destructive">{formError || error}</p>
        </div>
      )}

      <div className="gap-6 py-2 md:grid md:grid-cols-2">
        <div className="min-w-0 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name">Display Name</Label>
            <div className="flex gap-2">
              <Input
                id="edit-name"
                type="text"
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                placeholder={savedAddon.manifest.name}
                maxLength={100}
                required
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setFormData((prev) => ({ ...prev, name: '' }))}
                disabled={!formData.name}
                className="shrink-0 text-xs text-muted-foreground"
              >
                Reset
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-logo">Logo URL</Label>
            <div className="flex gap-2">
              <Input
                id="edit-logo"
                type="text"
                value={formData.customLogo}
                onChange={(e) => setFormData((prev) => ({ ...prev, customLogo: e.target.value }))}
                placeholder="https://..."
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setFormData((prev) => ({ ...prev, customLogo: '' }))}
                disabled={!formData.customLogo}
                className="shrink-0 text-xs text-muted-foreground"
              >
                Reset
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-description">Description</Label>
            <div className="flex gap-2">
              <textarea
                id="edit-description"
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                value={formData.customDescription}
                onChange={(e) => setFormData((prev) => ({ ...prev, customDescription: e.target.value }))}
                placeholder={savedAddon.manifest.description}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setFormData((prev) => ({ ...prev, customDescription: '' }))}
                disabled={!formData.customDescription}
                className="mt-1 shrink-0 text-xs text-muted-foreground"
              >
                Reset
              </Button>
            </div>
          </div>
        </div>

        <div className="pt-4 md:pt-0">
          <div className="flex h-full min-h-[250px] flex-col items-center justify-center gap-4 overflow-hidden rounded-md border bg-muted/20 p-4">
            <span className="text-xs font-medium uppercase text-muted-foreground">Dashboard Preview</span>

            <div className="flex w-full flex-col items-center gap-3">
              <AddonIcon
                name={formData.name || savedAddon.manifest.name}
                logo={formData.customLogo || savedAddon.manifest.logo}
                alt="Logo Preview"
                className="h-16 w-16 sm:h-20 sm:w-20"
                textClassName="text-2xl"
              />
              <span className="w-full break-words px-2 text-center text-base font-bold line-clamp-2 sm:text-lg">
                {formData.name || savedAddon.manifest.name}
              </span>
              <div className="w-full px-2 text-center sm:px-4">
                <p className="break-words text-xs italic leading-relaxed text-muted-foreground line-clamp-4 sm:line-clamp-6">
                  {formData.customDescription || savedAddon.manifest.description}
                </p>
              </div>
              <span className="mt-2 shrink-0 rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
                v{savedAddon.manifest.version}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
            <Label htmlFor="edit-profile">Profile</Label>
            <Select
              value={formData.profileId}
              onValueChange={(value) => setFormData((prev) => ({ ...prev, profileId: value }))}
            >
              <SelectTrigger id="edit-profile">
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {profiles.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>{profile.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-0.5">
            <Label htmlFor="sync-with-installed" className="block truncate text-sm font-semibold">Keep in sync with installed versions</Label>
            <p className="text-xs text-muted-foreground">
              {deployedAccounts.length > 0
                ? `Auto-push changes to ${deployedAccounts.length} account${deployedAccounts.length !== 1 ? 's' : ''} where this is installed.`
                : 'Auto-push URL and metadata changes to accounts where this addon is installed.'}
            </p>
            {deployedAccounts.length > 0 && (
              <p className="text-xs text-muted-foreground/70">
                {deployedAccounts.map(a => a.name || a.email || a.id).join(', ')}
              </p>
            )}
          </div>
          <div className="flex-shrink-0">
            <Switch
              id="sync-with-installed"
              checked={formData.syncWithInstalled}
              onCheckedChange={(checked) => setFormData(prev => ({ ...prev, syncWithInstalled: checked }))}
            />
          </div>
        </div>
      </div>

      <div className="-mx-6 mt-4 grid grid-cols-1 gap-4 border-t bg-muted/50 px-6 py-4 text-xs text-muted-foreground sm:grid-cols-2">
        <div>
          <span className="mb-1 block font-semibold">Developer Info</span>
          <p className="break-all line-clamp-2">ID: {isPrivacyModeEnabled ? '********' : savedAddon.manifest.id}</p>
          <p className="break-words line-clamp-2">Name: {savedAddon.manifest.name}</p>
          <p>Version: {savedAddon.manifest.version}</p>
          <p>Source: {savedAddon.sourceType === 'manual' ? 'Manual' : 'Cloned from account'}</p>
          <p>Updated: {new Date(savedAddon.updatedAt).toLocaleDateString()}</p>
        </div>
        <div>
          <span className="mb-1 block font-semibold">Source URL</span>
          <SourceUrlBox
            url={savedAddon.installUrl}
            manifest={savedAddon.manifest}
            privacyMode={isPrivacyModeEnabled}
            variant="compact"
            onReplace={handleReplaceUrl}
            successDescription="Library entry, installed copies, and Autopilot rules were updated."
            className="mt-1 bg-background/45"
          />
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between [&_button]:h-11 [&_button]:w-full [&_button]:rounded-full [&_button]:px-5 sm:[&_button]:w-auto">
        <Button type="button" variant="subtle" disabled={loading} onClick={handleResetDefaults}>
          Reset to Defaults
        </Button>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button type="button" variant="subtle" disabled={loading} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={loading || !hasChanges}>
            {loading ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </form>
  )
}
