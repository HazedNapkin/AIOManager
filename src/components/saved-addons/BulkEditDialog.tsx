import { Button } from '@/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { TagInput } from '@/components/ui/tag-input'
import { TagSelector } from '@/components/ui/tag-selector'
import { useAddonStore } from '@/store/addonStore'
import { useProfileStore } from '@/store/profileStore'
import { Loader2, Tags, User, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState, useMemo } from 'react'

interface BulkEditDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    selectedCount: number
    availableTags: string[]
    onSave: (data: { tags?: string[]; tagsRemove?: string[]; profileId?: string | null; syncWithInstalled?: boolean }) => Promise<void>
}

export function BulkEditDialog({ open, onOpenChange, selectedCount, availableTags, onSave }: BulkEditDialogProps) {
    const profiles = useProfileStore(s => s.profiles)
    const library = useAddonStore(s => s.library)

    const allKnownTags = useMemo(() => {
        const tagsSet = new Set<string>()
        Object.values(library).forEach((savedAddon) => {
            savedAddon.tags.forEach((tag) => tagsSet.add(tag))
        })
        return Array.from(tagsSet).sort()
    }, [library])

    const [loading, setLoading] = useState(false)

    const [tagsToAdd, setTagsToAdd] = useState<string[]>([])
    const [tagsToRemove, setTagsToRemove] = useState<string[]>([])
    const [selectedProfileId, setSelectedProfileId] = useState<string>('no-change')
    const [syncWithInstalled, setSyncWithInstalled] = useState<'no-change' | boolean>('no-change')
    const syncCardRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (open) {
            setTagsToAdd([])
            setTagsToRemove([])
            setSelectedProfileId('no-change')
            setSyncWithInstalled('no-change')
        }
    }, [open])

    const handleSave = async () => {
        setLoading(true)
        try {
            const data: { tags?: string[]; tagsRemove?: string[]; profileId?: string | null; syncWithInstalled?: boolean } = {}

            if (tagsToAdd.length > 0) {
                data.tags = tagsToAdd
            }

            if (tagsToRemove.length > 0) {
                data.tagsRemove = tagsToRemove
            }

            if (selectedProfileId !== 'no-change') {
                data.profileId = selectedProfileId === 'unassigned' ? null : selectedProfileId
            }

            if (syncWithInstalled !== 'no-change') {
                data.syncWithInstalled = syncWithInstalled
            }

            await onSave(data)
            onOpenChange(false)
        } catch (error) {
            if (import.meta.env.DEV) console.error(error)
        } finally {
            setLoading(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>Edit {selectedCount} Addon{selectedCount !== 1 ? 's' : ''}</DialogTitle>
                    <DialogDescription>
                        Configure tags and profile assignment for all selected library items.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-6 py-6">
                    <Card className="border shadow-none">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-xs font-medium flex items-center gap-2 uppercase text-muted-foreground">
                                <Tags className="h-4 w-4" />
                                Tag Management
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="grid gap-5">
                            <div className="grid gap-2">
                                <Label className="text-xs font-medium">Add Tags</Label>
                                <TagInput
                                    value={tagsToAdd}
                                    onChange={setTagsToAdd}
                                    placeholder="Type and press Enter to add..."
                                    suggestions={allKnownTags}
                                />
                                <p className="text-xs text-muted-foreground">
                                    These tags will be appended to the selection.
                                </p>
                            </div>

                            <div className="grid gap-2">
                                <Label className="text-xs font-medium">Remove Tags</Label>
                                <TagSelector
                                    value={tagsToRemove}
                                    onChange={setTagsToRemove}
                                    options={availableTags}
                                    placeholder="Select tags to remove..."
                                />
                                <p className="text-xs text-muted-foreground">
                                    Only tags currently present in the selection are shown here.
                                </p>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="border shadow-none">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-xs font-medium flex items-center gap-2 uppercase text-muted-foreground">
                                <User className="h-4 w-4" />
                                Profile Migration
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="grid gap-2">
                                <Label htmlFor="profile" className="text-xs font-medium">Assign to Profile</Label>
                                <Select value={selectedProfileId} onValueChange={setSelectedProfileId}>
                                    <SelectTrigger className="bg-background">
                                        <SelectValue placeholder="No profile change" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="no-change"><i>Don't change profile</i></SelectItem>
                                        <SelectItem value="unassigned">Move to Unassigned</SelectItem>
                                        {profiles.map((profile) => (
                                            <SelectItem key={profile.id} value={profile.id}>
                                                {profile.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </CardContent>
                    </Card>

                    <Card ref={syncCardRef} className="border shadow-none">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-xs font-medium flex items-center gap-2 uppercase text-muted-foreground">
                                <RefreshCw className="h-4 w-4" />
                                Version Sync
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="flex items-center justify-between gap-4">
                                <div className="space-y-0.5">
                                    <Label className="text-xs font-medium">Keep in sync with installed versions</Label>
                                    <p className="text-xs text-muted-foreground">Automatically updates library entries when installed addons are updated.</p>
                                </div>
                                <Select value={String(syncWithInstalled)} onValueChange={(v) => setSyncWithInstalled(v === 'no-change' ? 'no-change' : v === 'true')}>
                                    <SelectTrigger className="bg-background w-32 shrink-0">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="no-change"><i>No change</i></SelectItem>
                                        <SelectItem value="true">Enable</SelectItem>
                                        <SelectItem value="false">Disable</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </CardContent>
                    </Card>

                    <div className="bg-muted/30 border border-dashed rounded-lg p-3 space-y-2">
                        <h4 className="text-xs font-bold uppercase text-muted-foreground">Change Preview</h4>
                        <div className="text-xs space-y-1">
                            {tagsToAdd.length > 0 && (
                                <p>• Will add <b>{tagsToAdd.length}</b> tag{tagsToAdd.length !== 1 ? 's' : ''}: <span className="text-primary">{tagsToAdd.join(', ')}</span></p>
                            )}
                            {tagsToRemove.length > 0 && (
                                <p>• Will remove <b>{tagsToRemove.length}</b> tag{tagsToRemove.length !== 1 ? 's' : ''}: <span className="text-destructive">{tagsToRemove.join(', ')}</span></p>
                            )}
                            {selectedProfileId !== 'no-change' && (
                                <p>• Will move to <b>{selectedProfileId === 'unassigned' ? 'Unassigned' : profiles.find(p => p.id === selectedProfileId)?.name}</b> profile.</p>
                            )}
                            {syncWithInstalled !== 'no-change' && (
                                <p>• Will <b>{syncWithInstalled ? 'enable' : 'disable'}</b> version sync.</p>
                            )}
                            {tagsToAdd.length === 0 && tagsToRemove.length === 0 && selectedProfileId === 'no-change' && syncWithInstalled === 'no-change' && (
                                <p className="italic text-muted-foreground">No changes configured.</p>
                            )}
                        </div>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="subtle" onClick={() => onOpenChange(false)} disabled={loading}>
                        Cancel
                    </Button>
                    <Button onClick={handleSave} disabled={loading} className="gap-2">
                        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                        Apply Changes
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
