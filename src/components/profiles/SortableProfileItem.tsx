import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, User } from 'lucide-react'
import React from 'react'
import { Profile } from '@/types/profile'
import { useTheme } from '@/contexts/ThemeContext'
import { cn } from '@/lib/utils'
import { Tooltip } from '@/components/ui/tooltip'

interface SortableProfileItemProps {
    id: string
    profile: Profile
}

export const SortableProfileItem = React.memo(function SortableProfileItem({ id, profile }: SortableProfileItemProps) {
    const { isLight } = useTheme()
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id })

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    }

    return (
        <div
            ref={setNodeRef}
            className={cn(
                'flex items-center gap-3 p-3 bg-card border rounded-lg',
                !isDragging && 'transition-[transform,opacity,box-shadow] duration-200',
                isDragging && `shadow-xl z-50 border-primary scale-[1.02] ring-2 ${isLight ? 'ring-primary/20' : 'ring-primary/8'}`,
                !isDragging && 'shadow-sm'
            )}
            style={style}
        >
            <Tooltip content="Drag to reorder" side="top">
            <div
                {...attributes}
                {...listeners}
                className="
                    -ml-2 p-3 cursor-grab active:cursor-grabbing
                    text-muted-foreground hover:text-foreground
                    hover:bg-accent rounded-md transition-colors
                    shrink-0
                "
                style={{ touchAction: 'none' }}
            >
                <GripVertical className="h-5 w-5" />
            </div>
            </Tooltip>

            <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="bg-muted p-2 rounded-full shrink-0">
                    <User className="w-4 h-4 text-muted-foreground" />
                </div>

                <div className="flex flex-col min-w-0">
                    <p className="font-medium text-sm truncate">{profile.name}</p>
                    {profile.description && (
                        <p className="text-xs text-muted-foreground truncate">
                            {profile.description}
                        </p>
                    )}
                </div>
            </div>
        </div>
    )
})
