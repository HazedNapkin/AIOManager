import { ReorderDialog } from '@/components/ui/reorder-dialog'
import { Profile } from '@/types/profile'
import { SortableProfileItem } from './SortableProfileItem'
import { useProfileStore } from '@/store/profileStore'

interface ProfileReorderDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
}

export function ProfileReorderDialog({
    open,
    onOpenChange,
}: ProfileReorderDialogProps) {
    const profiles = useProfileStore(s => s.profiles)
    const reorderProfiles = useProfileStore(s => s.reorderProfiles)

    return (
        <ReorderDialog<Profile>
            title="Reorder Profiles"
            description="Drag and drop to reorder your profiles."
            items={profiles}
            getId={(profile) => profile.id}
            renderRow={(profile) => <SortableProfileItem id={profile.id} profile={profile} />}
            onSave={(ordered) => reorderProfiles(ordered)}
            saveErrorMessage="Failed to save profile order"
            open={open}
            onOpenChange={onOpenChange}
            contentClassName="max-w-md"
            bodyClassName="max-h-[60vh] overflow-y-auto py-4"
            emptyMessage="No profiles to reorder."
        />
    )
}
