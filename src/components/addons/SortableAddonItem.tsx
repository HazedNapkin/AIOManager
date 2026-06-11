import { AddonDescriptor } from '@/types/addon'
import { useTheme } from '@/contexts/ThemeContext'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, ShieldCheck } from 'lucide-react'
import { memo } from 'react'
import { AddonIcon } from '@/components/ui/addon-icon'

interface SortableAddonItemProps {
  addon: AddonDescriptor
  id: string
}

interface AddonReorderRowProps {
  addon: AddonDescriptor
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>
  isDragging?: boolean
  isOverlay?: boolean
  setNodeRef?: (node: HTMLDivElement | null) => void
  style?: React.CSSProperties
}

export const AddonReorderRow = memo(function AddonReorderRow({
  addon,
  dragHandleProps,
  isDragging = false,
  isOverlay = false,
  setNodeRef,
  style,
}: AddonReorderRowProps) {
  const { isLight } = useTheme()

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={[
        'flex w-full items-center gap-3 rounded-2xl border bg-card p-3',
        !isDragging ? 'transition-[transform,opacity,box-shadow,border-color] duration-200' : '',
        isOverlay
          ? `cursor-grabbing border-primary/60 shadow-2xl ring-2 ${isLight ? 'ring-primary/20' : 'ring-primary/10'}`
          : isDragging
            ? 'opacity-0'
            : 'border-border/40 shadow-sm hover:border-border hover:shadow-md',
      ].join(' ')}
    >
      {/* Drag Handle */}
      <div
        {...dragHandleProps}
        className={[
          'shrink-0 rounded-lg p-2 text-muted-foreground transition-colors',
          isOverlay ? 'cursor-grabbing' : 'cursor-grab hover:bg-muted/50 hover:text-foreground active:cursor-grabbing',
        ].join(' ')}
        style={{ touchAction: 'none' }}
      >
        <GripVertical className="h-4 w-4" />
      </div>

      <AddonIcon
        name={addon.metadata?.customName || addon.manifest.name || 'Addon'}
        logo={addon.metadata?.customLogo || addon.manifest.logo}
        alt={addon.metadata?.customName || addon.manifest.name}
        className="h-9 w-9"
        textClassName="text-xs"
      />

      {/* Addon Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-sm truncate">
            {addon.metadata?.customName || addon.manifest.name}
          </h3>
          {addon.flags?.protected && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold uppercase text-muted-foreground bg-muted/50 border border-border/40 rounded-full px-1.5 py-0.5 shrink-0">
              <ShieldCheck className="h-2.5 w-2.5" />
              Protected
            </span>
          )}
          {addon.flags?.official && !addon.flags?.protected && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold uppercase text-primary bg-primary/12 border border-primary/25 rounded-full px-1.5 py-0.5 shrink-0">
              Official
            </span>
          )}
        </div>
        <p className="text-xs font-mono text-muted-foreground">v{addon.manifest.version}</p>
      </div>
    </div>
  )
})

export const SortableAddonItem = memo(function SortableAddonItem({ addon, id }: SortableAddonItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  })

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  }

  return (
    <AddonReorderRow
      addon={addon}
      dragHandleProps={{ ...attributes, ...listeners }}
      isDragging={isDragging}
      setNodeRef={setNodeRef}
      style={style}
    />
  )
})
