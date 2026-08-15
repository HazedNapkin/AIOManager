import { Fragment, ReactNode, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  DndContext,
  closestCenter,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface ReorderDialogProps<T> {
  title: string
  description?: string
  items: T[]
  getId: (item: T) => string
  renderRow: (item: T) => ReactNode
  renderOverlay?: (item: T) => ReactNode
  onSave: (orderedItems: T[]) => Promise<void>
  onReset?: () => T[]
  resetLabel?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  contentClassName?: string
  bodyClassName?: string
  emptyMessage?: string
  saveErrorMessage?: string
}

export function ReorderDialog<T>({
  title,
  description,
  items,
  getId,
  renderRow,
  renderOverlay,
  onSave,
  onReset,
  resetLabel = 'Reset',
  open,
  onOpenChange,
  contentClassName = 'max-w-2xl',
  bodyClassName = 'max-h-[70vh] overflow-y-auto py-4',
  emptyMessage,
  saveErrorMessage = 'Failed to save order',
}: ReorderDialogProps<T>) {
  const [ordered, setOrdered] = useState<T[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Snapshot only on open: a live `items` dep would reset an in-progress arrangement
  // whenever the parent store writes (health checks, background sync pulls).
  const itemsRef = useRef(items)
  itemsRef.current = items

  useEffect(() => {
    if (open) {
      setOrdered(itemsRef.current)
      setError(null)
    }
  }, [open])

  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 3,
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

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id))
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    if (over && active.id !== over.id) {
      setOrdered((current) => {
        const oldIndex = current.findIndex((item) => getId(item) === active.id)
        const newIndex = current.findIndex((item) => getId(item) === over.id)
        return arrayMove(current, oldIndex, newIndex)
      })
    }
    setActiveId(null)
  }

  const handleDragCancel = () => {
    setActiveId(null)
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      await onSave(ordered)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : saveErrorMessage)
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    if (!onReset) return
    setOrdered(onReset())
    setActiveId(null)
  }

  const activeItem = activeId !== null ? ordered.find((item) => getId(item) === activeId) ?? null : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={contentClassName}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div className={bodyClassName}>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
            modifiers={[restrictToVerticalAxis]}
          >
            <SortableContext
              items={ordered.map((item) => getId(item))}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {ordered.length === 0 && emptyMessage && (
                  <p className="text-center text-muted-foreground py-4">{emptyMessage}</p>
                )}
                {ordered.map((item) => (
                  <Fragment key={getId(item)}>{renderRow(item)}</Fragment>
                ))}
              </div>
            </SortableContext>
            {renderOverlay &&
              createPortal(
                <DragOverlay adjustScale={false} dropAnimation={null}>
                  {activeItem ? renderOverlay(activeItem) : null}
                </DragOverlay>,
                document.body
              )}
          </DndContext>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          {onReset && (
            <Button type="button" variant="subtle" onClick={handleReset} disabled={saving} className="mr-auto">
              {resetLabel}
            </Button>
          )}
          <Button variant="subtle" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
