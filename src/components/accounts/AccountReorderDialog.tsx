import { useState, useEffect } from 'react'
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
import { Account } from '@/types/account'
import { AccountReorderRow, SortableAccountCard } from './SortableAccountCard'
import { useAccounts } from '@/hooks/useAccounts'
import { createPortal } from 'react-dom'

interface AccountReorderDialogProps {
  accounts: Account[]
  open: boolean
  onOpenChange: (open: boolean) => void
  isPrivacyMode?: boolean
}

export function AccountReorderDialog({
  accounts,
  open,
  onOpenChange,
  isPrivacyMode = false,
}: AccountReorderDialogProps) {
  const [items, setItems] = useState<Account[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { reorderAccounts } = useAccounts()
  const activeAccount = activeId ? items.find((account) => account.id === activeId) : null

  useEffect(() => {
    if (open) {
      setItems(accounts)
      setError(null)
    }
  }, [open, accounts])

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 3 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id))
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      setItems((current) => {
        const oldIndex = current.findIndex((a) => a.id === active.id)
        const newIndex = current.findIndex((a) => a.id === over.id)
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
      await reorderAccounts(items.map((a) => a.id))
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save account order')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] sm:max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Reorder Accounts</DialogTitle>
          <DialogDescription>
            Drag accounts to change their order. Save to apply.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-2 sm:py-4">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <SortableContext items={items.map((a) => a.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {items.map((account) => (
                  <SortableAccountCard
                    key={account.id}
                    account={account}
                    isPrivacyMode={isPrivacyMode}
                    compact
                  />
                ))}
              </div>
            </SortableContext>
            {createPortal(
              <DragOverlay adjustScale={false} dropAnimation={null}>
                {activeAccount ? (
                  <AccountReorderRow account={activeAccount} isPrivacyMode={isPrivacyMode} isOverlay />
                ) : null}
              </DragOverlay>,
              document.body
            )}
          </DndContext>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
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
