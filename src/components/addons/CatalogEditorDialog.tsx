import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { AddonDescriptor, Catalog } from '@/types/addon'
import { isCinemetaAddon } from '@/lib/cinemeta-utils'
import {
    DndContext,
    closestCenter,
    MouseSensor,
    TouchSensor,
    KeyboardSensor,
    useSensor,
    useSensors,
    DragEndEvent,
} from '@dnd-kit/core'
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Trash2, Info } from 'lucide-react'
import { useState, useEffect } from 'react'

interface SortableCatalogItemProps {
    catalog: Catalog & { _tempId: string }
    onRename: (id: string, name: string) => void
    onDelete: (id: string) => void
}

function SortableCatalogItem({ catalog, onRename, onDelete }: SortableCatalogItemProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: catalog._tempId })

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    }

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={cn(
                'group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-border/45 bg-card p-2.5 transition-[border-color,background-color,box-shadow,transform,opacity]',
                'hover:border-border/70 hover:bg-muted/20',
                isDragging ? 'scale-[0.99] border-primary/35 bg-primary/10 shadow-lg' : ''
            )}
        >
            <Tooltip content="Drag to reorder" side="top">
            <button
                {...attributes}
                {...listeners}
                type="button"
                aria-label={`Drag ${catalog.name || catalog.id} to reorder`}
                className="flex h-10 w-10 shrink-0 cursor-grab items-center justify-center rounded-lg border border-border/45 bg-muted/20 text-muted-foreground transition-colors hover:border-border/70 hover:bg-accent hover:text-foreground active:cursor-grabbing"
                style={{ touchAction: 'none' }}
            >
                <GripVertical className="h-4 w-4" />
            </button>
            </Tooltip>

            <div className="flex-1 min-w-0">
                <Input
                    value={catalog.name || ''}
                    placeholder={`${catalog.type} - ${catalog.id}`}
                    onChange={(e) => onRename(catalog._tempId, e.target.value)}
                    className="h-9 rounded-lg text-sm font-medium"
                />
                <div className="mt-1 truncate px-1 text-xs text-muted-foreground">
                    Type: {catalog.type} • ID: {catalog.id}
                </div>
            </div>

            <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onDelete(catalog._tempId)}
                className="h-9 w-9 rounded-full text-destructive/75 hover:bg-destructive/10 hover:text-destructive"
                aria-label={`Delete ${catalog.name || catalog.id}`}
            >
                <Trash2 className="h-4 w-4" />
            </Button>
        </div>
    )
}

interface CatalogEditorDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    addon: AddonDescriptor
    onSave: (updatedAddon: AddonDescriptor) => Promise<void>
}

export function CatalogEditorDialog({
    open,
    onOpenChange,
    addon,
    onSave,
}: CatalogEditorDialogProps) {
    const [catalogs, setCatalogs] = useState<(Catalog & { _tempId: string })[]>([])
    const [saving, setSaving] = useState(false)
    const [hasChanges, setHasChanges] = useState(false)

    const sensors = useSensors(
        useSensor(MouseSensor, {
            activationConstraint: {
                distance: 5,
            },
        }),
        useSensor(TouchSensor, {
            activationConstraint: {
                delay: 200,
                tolerance: 5,
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    )

    useEffect(() => {
        if (open && addon.manifest.catalogs) {
            const overrideCatalogs = addon.catalogOverrides?.catalogs
            const removedIds = new Set(addon.catalogOverrides?.removed || [])
            const sourceCatalogs = overrideCatalogs || addon.manifest.catalogs

            const effectiveCatalogs = sourceCatalogs
                .filter(cat => overrideCatalogs || !removedIds.has(cat.id))
                .map((cat, idx) => ({
                    ...cat,
                    _tempId: `${cat.id}-${cat.type}-${idx}`,
                }))

            setCatalogs(effectiveCatalogs)
            setHasChanges(false)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open])

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event

        if (over && active.id !== over.id) {
            setCatalogs((items) => {
                const oldIndex = items.findIndex((item) => item._tempId === active.id)
                const newIndex = items.findIndex((item) => item._tempId === over.id)
                setHasChanges(true)
                return arrayMove(items, oldIndex, newIndex)
            })
        }
    }

    const handleRename = (id: string, name: string) => {
        setCatalogs((items) =>
            items.map((item) =>
                item._tempId === id ? { ...item, name } : item
            )
        )
        setHasChanges(true)
    }

    const handleDelete = (id: string) => {
        setCatalogs((items) => items.filter((item) => item._tempId !== id))
        setHasChanges(true)
    }

    const handleSave = async () => {
        setSaving(true)
        try {
            const cleanedCatalogs: Catalog[] = catalogs.map(({ _tempId, ...rest }) => rest)

            const updatedAddon: AddonDescriptor = {
                ...addon,
                manifest: {
                    ...addon.manifest,
                    catalogs: cleanedCatalogs,
                },
                catalogOverrides: {
                    ...addon.catalogOverrides,
                    removed: [],
                    catalogs: cleanedCatalogs,
                }
            }

            await onSave(updatedAddon)

            toast({
                title: 'Catalogs Updated',
                description: `Changes saved for ${addon.manifest.name}`,
            })

            onOpenChange(false)
        } catch (error) {
            toast({
                variant: 'destructive',
                title: 'Failed to Save',
                description: error instanceof Error ? error.message : 'Unknown error',
            })
        } finally {
            setSaving(false)
        }
    }

    const handleReset = async () => {
        setSaving(true)
        try {
            const { fetchAddonManifest } = await import('@/api/addons')
            const fresh = await fetchAddonManifest(addon.transportUrl)

            if (fresh.manifest.catalogs) {
                const freshCatalogs = fresh.manifest.catalogs.map((cat, idx) => ({
                    ...cat,
                    _tempId: `${cat.id}-${cat.type}-${idx}`,
                }))
                setCatalogs(freshCatalogs)
                setHasChanges(true)
                toast({
                    title: 'Catalogs Reset',
                    description: 'Loaded original catalogs from addon. Click Save to apply.',
                })
            }
        } catch (error) {
            toast({
                variant: 'destructive',
                title: 'Reset Failed',
                description: 'Could not fetch original manifest.',
            })
        } finally {
            setSaving(false)
        }
    }

    const catalogCount = catalogs.length
    const isCinemeta = isCinemetaAddon(addon)

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[88vh] overflow-hidden sm:max-w-lg flex flex-col">
                <DialogHeader>
                    <DialogTitle>Edit Catalogs: {addon.manifest.name}</DialogTitle>
                    <DialogDescription>
                        Drag to reorder, rename, or delete catalogs. {catalogCount} catalog{catalogCount !== 1 ? 's' : ''}.
                    </DialogDescription>
                </DialogHeader>
                {isCinemeta && (
                    <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>
                            Stremio keeps official Cinemeta catalog labels, so renames may still show as Popular, New, or Featured there. Deleting and reordering Cinemeta catalogs still applies.
                        </span>
                    </div>
                )}

                <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable] -mr-2 pr-3 py-4">
                    {catalogs.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-border/45 bg-muted/10 py-10 text-center text-sm text-muted-foreground">
                            This addon has no catalogs
                        </div>
                    ) : (
                        <DndContext
                            sensors={sensors}
                            collisionDetection={closestCenter}
                            onDragEnd={handleDragEnd}
                        >
                            <SortableContext
                                items={catalogs.map((c) => c._tempId)}
                                strategy={verticalListSortingStrategy}
                            >
                                <div className="space-y-2">
                                    {catalogs.map((catalog) => (
                                        <SortableCatalogItem
                                            key={catalog._tempId}
                                            catalog={catalog}
                                            onRename={handleRename}
                                            onDelete={handleDelete}
                                        />
                                    ))}
                                </div>
                            </SortableContext>
                        </DndContext>
                    )}
                </div>

                <DialogFooter>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleReset}
                        disabled={saving}
                        className="mr-auto text-muted-foreground hover:text-foreground"
                    >
                        Default
                    </Button>
                    <Button variant="subtle" onClick={() => onOpenChange(false)} disabled={saving}>
                        Cancel
                    </Button>
                    <Button onClick={handleSave} disabled={!hasChanges || saving}>
                        {saving ? 'Saving...' : 'Save Changes'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
