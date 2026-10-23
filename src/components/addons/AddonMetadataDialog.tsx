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
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Upload, ChevronDown, ChevronRight, Check, Minus } from 'lucide-react'
import { AddonIcon } from '@/components/ui/addon-icon'
import { AddonDescriptor } from '@/types/addon'
import { useEffect, useMemo, useState } from 'react'
import { useUIStore } from '@/store/uiStore'
import { useAccountStore } from '@/store/accountStore'
import { isAddonConnection } from '@/types/connection'
import { getPlatformEntry } from '@/lib/platform-registry'
import { normalizeDestinations, nextPolicyRevision } from '@/lib/addon-destinations'
import { maskEmailLevel, maskNameLevel, maskProfileLevel } from '@/lib/utils'
import { PlatformLogo } from '@/components/providers/ConnectionPrimitives'
import { SourceUrlBox } from './SourceUrlBox'
import { ManifestJSONEditor } from './ManifestJSONEditor'

interface AddonMetadataDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    addon: AddonDescriptor
    accountId: string
    onSave: (metadata: { customName?: string; customLogo?: string; customDescription?: string }, destinations?: AddonDescriptor['destinations'] | null) => Promise<void>
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
    const [draftExcludedPlatforms, setDraftExcludedPlatforms] = useState<Set<string>>(new Set())
    const [draftExcludedConnections, setDraftExcludedConnections] = useState<Set<string>>(new Set())
    const [expandedPlatform, setExpandedPlatform] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const isPrivacyModeEnabled = useUIStore((state) => state.isPrivacyModeEnabled)
    const privacyLevelNames = useUIStore(state => state.privacyLevelNames)
    const privacyLevelEmail = useUIStore(state => state.privacyLevelEmail)
    const privacyLevelProfiles = useUIStore(state => state.privacyLevelProfiles)

    const account = useAccountStore((state) => state.accounts.find(a => a.id === accountId))
    // Addon destinations: every addon-capable connection of the owning account
    // (Stremio logins included — they are fan-out targets even though their pushes
    // bypass the connection reconcile batch).
    const destinationConnections = useMemo(
        () => (account?.connections || []).filter(isAddonConnection),
        [account],
    )
    const platforms = useMemo(() => {
        const seen: string[] = []
        for (const conn of destinationConnections) {
            if (!seen.includes(conn.platform)) seen.push(conn.platform)
        }
        return seen
    }, [destinationConnections])

    const savedExcludedPlatforms = useMemo(
        () => [...(addon.destinations?.excludedPlatforms || [])].sort().join(','),
        [addon],
    )
    const savedExcludedConnections = useMemo(
        () => [...(addon.destinations?.excludedConnections || [])].sort().join(','),
        [addon],
    )
    const destinationsDirty =
        [...draftExcludedPlatforms].sort().join(',') !== savedExcludedPlatforms ||
        [...draftExcludedConnections].sort().join(',') !== savedExcludedConnections

    const hasChanges =
        customName !== (addon.metadata?.customName || '') ||
        customLogo !== (addon.metadata?.customLogo || '') ||
        customDescription !== (addon.metadata?.customDescription || '') ||
        destinationsDirty


    useEffect(() => {
        if (open) {
            setCustomName(addon.metadata?.customName || '')
            setCustomLogo(addon.metadata?.customLogo || '')
            setCustomDescription(addon.metadata?.customDescription || '')
            // Drafts seed from the FULL saved policy, including ids whose login no
            // longer exists: the picker below renders live connections only, so those
            // ids are invisible yet ride through a Save verbatim as retained intent —
            // a deliberate exclusion must outlive the login's removal, so a restore
            // resurrecting the same id lands excluded. A metadata-only Save (no
            // destinations key) never touches the policy at all; only an explicit
            // toggle of a LIVE row adds or drops an id.
            setDraftExcludedPlatforms(new Set(addon.destinations?.excludedPlatforms || []))
            setDraftExcludedConnections(new Set(addon.destinations?.excludedConnections || []))
            setExpandedPlatform(null)
            setError(null)
        }
    }, [open, addon])

    const togglePlatform = (platform: string, kept: boolean) => {
        setDraftExcludedPlatforms(prev => {
            const next = new Set(prev)
            if (kept) next.delete(platform)
            else next.add(platform)
            return next
        })
        if (!kept) {
            // Platform exclusion supersedes per-login entries for that platform.
            setDraftExcludedConnections(prev => {
                const next = new Set(prev)
                for (const conn of destinationConnections) {
                    if (conn.platform === platform) next.delete(conn.id)
                }
                return next
            })
        }
    }

    const toggleConnection = (platform: string, connectionId: string, kept: boolean) => {
        const wasPlatformExcluded = draftExcludedPlatforms.has(platform)
        setDraftExcludedPlatforms(prev => {
            if (!kept || !prev.has(platform)) return prev
            const next = new Set(prev)
            // Re-including ONE login of an excluded platform re-includes only it:
            // drop the platform-wide rule and pin every OTHER login as excluded,
            // so the other logins' state is exactly preserved.
            next.delete(platform)
            return next
        })
        setDraftExcludedConnections(prev => {
            const next = new Set(prev)
            if (kept) {
                next.delete(connectionId)
                if (wasPlatformExcluded) {
                    for (const conn of destinationConnections) {
                        if (conn.platform === platform && conn.id !== connectionId) next.add(conn.id)
                    }
                }
            } else {
                next.add(connectionId)
            }
            return next
        })
    }

    const platformExcluded = (platform: string) => draftExcludedPlatforms.has(platform)
    const connectionExcluded = (platform: string, connectionId: string) =>
        platformExcluded(platform) || draftExcludedConnections.has(connectionId)
    const platformPartiallyExcluded = (platform: string) => {
        if (platformExcluded(platform)) return false
        return destinationConnections.some(c => c.platform === platform && draftExcludedConnections.has(c.id))
    }

    const catalogCount = addon.manifest?.catalogs?.length ?? 0
    const connectionIdentity = (conn: typeof destinationConnections[number]) => {
        const personalName = conn.displayName || conn.credentials?.email
        if (personalName) return personalName.includes('@')
            ? maskEmailLevel(personalName, isPrivacyModeEnabled ? privacyLevelEmail : 0)
            : maskNameLevel(personalName, isPrivacyModeEnabled ? privacyLevelNames : 0)
        return conn.credentials?.userId
            ? maskProfileLevel(conn.credentials.userId, isPrivacyModeEnabled ? privacyLevelProfiles : 0)
            : ''
    }

    const handleSave = async () => {
        setSaving(true)
        setError(null)
        try {
            const nextDestinations = destinationsDirty ? normalizeDestinations({
                excludedPlatforms: [...draftExcludedPlatforms],
                excludedConnections: [...draftExcludedConnections],
                // Every deliberate policy write bumps the LWW clock (never below the
                // current value + 1), so this edit — including a full CLEAR, which
                // survives as the { revision } tombstone — outranks any stale cloud
                // copy of the policy.
                revision: nextPolicyRevision(addon.destinations?.revision),
            }) ?? null : undefined
            await onSave({
                customName: customName.trim() || undefined,
                customLogo: customLogo.trim() || undefined,
                customDescription: customDescription.trim() || undefined,
            }, nextDestinations)
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
            <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl">
                <DialogHeader>
                    <DialogTitle>Edit Addon Details</DialogTitle>
                    <DialogDescription>
                        Customize this addon and choose where it syncs.
                    </DialogDescription>
                </DialogHeader>

                <Tabs defaultValue="customize" className="min-w-0 w-full">
                    <TabsList className="mb-6 w-full flex-nowrap sm:w-fit">
                        <TabsTrigger value="customize" className="flex-1 px-2 text-xs sm:flex-none sm:px-3.5 sm:text-sm">
                            Customize
                        </TabsTrigger>
                        <TabsTrigger value="destinations" className="flex-1 px-2 text-xs sm:flex-none sm:px-3.5 sm:text-sm">
                            Destinations
                        </TabsTrigger>
                        <TabsTrigger value="advanced" className="flex-1 px-2 text-xs sm:flex-none sm:px-3.5 sm:text-sm">
                            Advanced
                        </TabsTrigger>
                    </TabsList>

                    {/* forceMount keeps in-progress drafts (URL edit, destination
                        toggles, manifest JSON) alive across tab switches. Radix
                        never applies the hidden attribute to force-mounted
                        panels, so inactive ones are hidden via the data-state
                        class instead of unmounting. */}
                    <TabsContent value="customize" forceMount className="min-w-0 data-[state=inactive]:hidden">
                        <div className="min-w-0 md:grid md:grid-cols-2 gap-6 py-4">
                            <div className="min-w-0 space-y-4">

                                <div className="space-y-2">
                                    <Label htmlFor="name">Display Name</Label>
                                    <div className="flex gap-2">
                                        <Input
                                            id="name"
                                            className="min-w-0 flex-1"
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
                                            className="min-w-0 flex-1"
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
                                            className="min-w-0 flex-1"
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

                                <div className="space-y-2">
                                    <Label>Addon URL</Label>
                                    {onReplaceUrl ? (
                                        <SourceUrlBox
                                            addon={addon}
                                            accountId={accountId}
                                            privacyMode={isPrivacyModeEnabled}
                                            variant="compact"
                                            onReplace={handleReplaceUrl}
                                            successDescription="Addon URL updated successfully."
                                            className="bg-background/45"
                                        />
                                    ) : (
                                        <Tooltip content={isPrivacyModeEnabled ? 'Private addon URL' : addon.transportUrl}>
                                            <p className="break-all line-clamp-2 text-xs text-muted-foreground">
                                                URL: {isPrivacyModeEnabled ? '********' : addon.transportUrl}
                                            </p>
                                        </Tooltip>
                                    )}
                                </div>
                            </div>

                            <div className="min-w-0 space-y-4 pt-4 md:pt-0">

                                <div data-theme-part="panel" className="border rounded-md p-4 bg-muted/20 flex flex-col items-center justify-start gap-4 h-full min-h-[250px] overflow-hidden">
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
                                        <span data-theme-part="badge" className="text-xs text-muted-foreground px-2 py-1 bg-muted rounded-full mt-2 shrink-0">
                                            v{addon.manifest.version}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </TabsContent>

                    <TabsContent value="destinations" forceMount className="data-[state=inactive]:hidden">
                        {platforms.length > 0 ? (
                            <div data-theme-part="panel" className="rounded-md border border-border/40 bg-muted/10 p-4">
                                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sync to…</span>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    Unchecking a destination removes its copy on the next sync. Your AIOManager library keeps the addon.
                                    Changes apply when you save.
                                </p>
                                <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
                                    <div className="space-y-1.5" data-testid="destinations-picker">
                                        {platforms.map(platform => {
                                            const platformConns = destinationConnections.filter(c => c.platform === platform)
                                            const multi = platformConns.length > 1
                                            const excluded = platformExcluded(platform)
                                            const partial = platformPartiallyExcluded(platform)
                                            const expanded = expandedPlatform === platform
                                            return (
                                                <div key={platform} className="rounded-md border border-border/30 bg-background/40 px-3 py-2">
                                                    <div className="flex items-center gap-2">
                                                        <Checkbox
                                                            id={`dest-platform-${platform}`}
                                                            checked={!excluded}
                                                            onCheckedChange={(v) => togglePlatform(platform, v === true)}
                                                            aria-label={`Sync to ${getPlatformEntry(platform)?.name || platform}`}
                                                        />
                                                        <button
                                                            type="button"
                                                            className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm font-medium"
                                                            onClick={() => multi && setExpandedPlatform(expanded ? null : platform)}
                                                            aria-expanded={multi ? expanded : undefined}
                                                        >
                                                            <PlatformLogo platform={platform} className="h-5 w-5 shrink-0" />
                                                            <span className="truncate">{getPlatformEntry(platform)?.name || platform}</span>
                                                            <span className="shrink-0 text-[10px] text-muted-foreground">
                                                                {multi ? `(${platformConns.length} logins)` : ''}
                                                            </span>
                                                            {multi && (expanded
                                                                ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                                                : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />)}
                                                        </button>
                                                    </div>
                                                    {!excluded && (
                                                        <p className="pl-6 text-[10px] text-muted-foreground">
                                                            {partial ? 'Some logins excluded below' : 'Every login, present and future'}
                                                        </p>
                                                    )}
                                                    {excluded && (
                                                        <p className="pl-6 text-[10px] text-muted-foreground">No login of this platform, including future ones</p>
                                                    )}
                                                    {multi && expanded && (
                                                        <div className="mt-1.5 space-y-1 border-l border-border/40 pl-2">
                                                            {platformConns.map(conn => {
                                                                const connExcluded = connectionExcluded(platform, conn.id)
                                                                const who = [connectionIdentity(conn), `Connection ${platformConns.indexOf(conn) + 1}`].filter(Boolean).join(' · ')
                                                                return (
                                                                    <label key={conn.id} className="flex items-center gap-2 text-xs" htmlFor={`dest-conn-${conn.id}`}>
                                                                        <Checkbox
                                                                            id={`dest-conn-${conn.id}`}
                                                                            className="h-3.5 w-3.5"
                                                                            checked={!connExcluded}
                                                                            onCheckedChange={(v) => toggleConnection(platform, conn.id, v === true)}
                                                                        />
                                                                        <span className="min-w-0 flex-1 truncate text-muted-foreground">{who}</span>
                                                                        <span className={`shrink-0 text-[10px] font-medium ${connExcluded ? 'text-destructive' : 'text-muted-foreground'}`}>
                                                                            {connExcluded ? 'Removed on next sync' : 'Kept'}
                                                                        </span>
                                                                    </label>
                                                                )
                                                            })}
                                                        </div>
                                                    )}
                                                </div>
                                            )
                                        })}
                                    </div>
                                    <div className="space-y-2" data-testid="destinations-draft-preview">
                                        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Draft preview</span>
                                        <div data-testid="destination-tree" className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)] items-center gap-8 py-2">
                                            <div className="relative flex min-w-0 flex-col items-center gap-2 rounded-xl border border-border/40 bg-background/40 p-3 text-center after:absolute after:-right-4 after:top-1/2 after:w-4 after:border-t after:border-border/70">
                                                <AddonIcon name={customName || addon.manifest.name} logo={customLogo || addon.manifest.logo} alt="" className="h-10 w-10" textClassName="text-sm" />
                                                <p className="w-full break-words text-xs font-medium">{customName || addon.manifest.name}</p>
                                                <span className="text-[10px] text-muted-foreground">{catalogCount} catalog{catalogCount === 1 ? '' : 's'}</span>
                                            </div>
                                            <ul className="min-w-0" aria-label="Draft destinations">
                                                {destinationConnections.map((conn, index) => {
                                                    const kept = !connectionExcluded(conn.platform, conn.id)
                                                    const platformName = getPlatformEntry(conn.platform)?.name || conn.platform
                                                    const who = connectionIdentity(conn)
                                                    const status = kept ? (conn.enabled ? 'Will sync' : 'Sync paused') : 'Excluded'
                                                    return (
                                                        <li key={conn.id} data-destination-id={conn.id} data-destination-kept={kept} className="relative min-w-0 py-1.5 before:absolute before:-left-4 before:top-1/2 before:w-4 before:border-t before:border-border/70">
                                                            {destinationConnections.length > 1 && <span aria-hidden="true" className={`absolute -left-4 border-l border-border/70 ${index === 0 ? 'top-1/2 bottom-0' : index === destinationConnections.length - 1 ? 'top-0 bottom-1/2' : 'inset-y-0'}`} />}
                                                            <div className={`flex min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2 ${kept ? 'border-border/40 bg-background/40' : 'border-border/30 bg-muted/20'}`}>
                                                                <PlatformLogo platform={conn.platform} className="h-7 w-7 shrink-0" />
                                                                <div className="min-w-0 flex-1">
                                                                    <p className="truncate text-xs font-medium">{platformName}{destinationConnections.filter(peer => peer.platform === conn.platform).length > 1 ? ` · ${destinationConnections.filter(peer => peer.platform === conn.platform).indexOf(conn) + 1}` : ''}</p>
                                                                    {who && <p className="break-all text-[10px] leading-snug text-muted-foreground">{who}</p>}
                                                                    <p className="mt-0.5 text-[10px] text-muted-foreground">{status}</p>
                                                                </div>
                                                                {kept ? <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-primary" /> : <Minus aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                                                            </div>
                                                        </li>
                                                    )
                                                })}
                                            </ul>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <p className="py-6 text-sm text-muted-foreground">
                                This account has no addon-capable connections yet.
                            </p>
                        )}
                    </TabsContent>

                    <TabsContent value="advanced" forceMount className="data-[state=inactive]:hidden">
                        <div className="space-y-4 py-4 text-xs text-muted-foreground">
                            <div data-theme-part="panel" className="rounded-md border border-border/40 bg-muted/10 p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <span className="font-semibold block mb-1">Developer Info</span>
                                    <p className="break-all line-clamp-2">ID: {addon.manifest.id}</p>
                                    <p className="break-words line-clamp-2">Name: {addon.manifest.name}</p>
                                </div>
                                <div>
                                    <span className="font-semibold block mb-1">Technical Details</span>
                                    <p>Status: {addon.flags?.protected ? 'Protected' : 'Standard'}</p>
                                </div>
                            </div>

                            <ManifestJSONEditor
                                embedded
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
                        </div>
                    </TabsContent>
                </Tabs>

                {error && <p role="alert" className="text-sm text-destructive font-medium">{error}</p>}

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
