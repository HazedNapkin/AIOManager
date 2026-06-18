import { Button } from '@/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useProfileStore } from '@/store/profileStore'
import { Profile } from '@/types/profile'
import { Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useToast } from '@/hooks/use-toast'

interface ProfileDialogProps {
    profile?: Profile // If provided, we are editing
    trigger?: React.ReactNode
    onDelete?: (id: string) => void
}

export function ProfileDialog({ profile, trigger, onDelete }: ProfileDialogProps) {
    const [open, setOpen] = useState(false)
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const createProfile = useProfileStore(s => s.createProfile)
    const updateProfile = useProfileStore(s => s.updateProfile)
    const { toast } = useToast()

    useEffect(() => {
        if (open) {
            setName(profile?.name || '')
            setDescription(profile?.description || '')
        }
    }, [open, profile])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        if (!name.trim()) return

        try {
            if (profile) {
                await updateProfile(profile.id, { name, description })
                toast({ title: 'Profile updated', description: `Updated profile "${name}"` })
            } else {
                await createProfile(name, description)
                toast({ title: 'Profile created', description: `Created profile "${name}"` })
            }
            setOpen(false)
        } catch (error) {
            toast({
                variant: 'destructive',
                title: 'Error',
                description: 'Failed to save profile'
            })
        }
    }

    const handleDelete = () => {
        if (!profile || !onDelete) return
        setOpen(false)
        onDelete(profile.id)
    }

    return (
        <>
            <div onClick={() => setOpen(true)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true) } }} role="button" tabIndex={0} className="inline-block cursor-pointer">
                {trigger || (
                    <Button className="gap-2">
                        <Plus className="h-4 w-4" />
                        Create Profile
                    </Button>
                )}
            </div>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="sm:max-w-[460px]">
                    <DialogHeader>
                        <DialogTitle>{profile ? 'Edit Profile' : 'Create Profile'}</DialogTitle>
                        <DialogDescription>
                            {profile
                                ? 'Update how this saved-addons profile is labeled in your library.'
                                : 'Profiles are folders for saved addons, so you can keep separate collections for different people, devices, or setups.'}
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleSubmit} className="space-y-4 py-4">
                        <div className="grid gap-2">
                            <Label htmlFor="name">Profile name</Label>
                            <Input
                                id="name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="e.g. Kids, Guests, Testing"
                                required
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="description">Description (Optional)</Label>
                            <Textarea
                                id="description"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="What belongs in this profile?"
                                className="min-h-28 resize-y"
                            />
                        </div>
                        {!profile && (
                            <p className="rounded-xl border border-border/45 bg-muted/25 px-3 py-2 text-xs leading-snug text-muted-foreground">
                                After creating it, assign saved addons to this profile from the library or when saving addons from an account.
                            </p>
                        )}
                        <DialogFooter className={profile && onDelete ? 'sm:justify-between' : undefined}>
                            {profile && onDelete && (
                                <Button
                                    type="button"
                                    variant="subtle"
                                    onClick={handleDelete}
                                    className="text-destructive hover:text-destructive"
                                >
                                    Delete Profile
                                </Button>
                            )}
                            <Button type="submit">{profile ? 'Save Changes' : 'Create Profile'}</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </>
    )
}
