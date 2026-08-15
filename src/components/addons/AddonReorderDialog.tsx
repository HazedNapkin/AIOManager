import { useMemo } from 'react'
import { ReorderDialog } from '@/components/ui/reorder-dialog'
import { AddonDescriptor } from '@/types/addon'
import { AddonReorderRow, SortableAddonItem } from './SortableAddonItem'
import { useAccountStore } from '@/store/accountStore'

interface AddonReorderDialogProps {
  accountId: string
  addons: AddonDescriptor[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

type UniqueAddon = AddonDescriptor & { uniqueId: string }

export function AddonReorderDialog({
  accountId,
  addons,
  open,
  onOpenChange,
}: AddonReorderDialogProps) {
  const reorderAddons = useAccountStore((state) => state.reorderAddons)
  const items = useMemo<UniqueAddon[]>(
    () => addons.map((a, i) => ({ ...a, uniqueId: `${a.transportUrl}::${i}` })),
    [addons]
  )

  return (
    <ReorderDialog<UniqueAddon>
      title="Reorder Addons"
      description="Drag and drop to reorder your addons. Changes will be saved."
      items={items}
      getId={(item) => item.uniqueId}
      renderRow={(item) => <SortableAddonItem addon={item} id={item.uniqueId} />}
      renderOverlay={(item) => <AddonReorderRow addon={item} isOverlay />}
      onSave={async (ordered) => {
        const stripped = ordered.map(({ uniqueId: _uniqueId, ...rest }) => rest)
        await reorderAddons(accountId, stripped)
      }}
      saveErrorMessage="Failed to save addon order"
      open={open}
      onOpenChange={onOpenChange}
    />
  )
}
