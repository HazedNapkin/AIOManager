import { motion } from 'framer-motion'
import { useRef, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DiscoverCard } from './DiscoverCard'
import type { DiscoverAddon } from '@/api/discover'

interface DiscoverRowProps {
  title: string
  icon?: ReactNode
  addons: DiscoverAddon[]
  isSaved: (addon: DiscoverAddon) => boolean
  savingKey: string | null
  onSeeAll?: () => void
  onSave: (addon: DiscoverAddon) => void
  onDeploy: (addon: DiscoverAddon) => void
  onConfigure: (addon: DiscoverAddon) => void
  onOpenDetail: (addon: DiscoverAddon) => void
  isFavorite?: (addon: DiscoverAddon) => boolean
  onToggleFavorite?: (addon: DiscoverAddon) => void
  deployedCount?: (addon: DiscoverAddon) => number
  accountTotal?: number
}

export function DiscoverRow({
  title,
  icon,
  addons,
  isSaved,
  savingKey,
  onSeeAll,
  onSave,
  onDeploy,
  onConfigure,
  onOpenDetail,
  isFavorite,
  onToggleFavorite,
  deployedCount,
  accountTotal,
}: DiscoverRowProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  if (addons.length === 0) return null

  // Scroll by roughly one viewport of the row so it adapts to card width and screen size.
  const scroll = (dir: 1 | -1) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({ left: dir * Math.max(el.clientWidth * 0.9, 320), behavior: 'smooth' })
  }

  return (
    <section className="group/row space-y-3 rounded-2xl border border-border/40 bg-card/50 p-3 shadow-sm sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight">
          {icon}
          {title}
          <span className="rounded-full border border-border/40 bg-muted/40 px-2 py-0.5 text-xs font-medium text-muted-foreground">{addons.length}</span>
        </h3>
        {onSeeAll && (
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground" onClick={onSeeAll}>
            See all →
          </Button>
        )}
      </div>

      <div className="relative">
        <button
          type="button"
          aria-label="Scroll left"
          onClick={() => scroll(-1)}
          className="absolute left-0 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-border/40 bg-card/80 text-foreground/80 shadow-lg backdrop-blur transition-colors hover:bg-card"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button
          type="button"
          aria-label="Scroll right"
          onClick={() => scroll(1)}
          className="absolute right-0 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-border/40 bg-card/80 text-foreground/80 shadow-lg backdrop-blur transition-colors hover:bg-card"
        >
          <ChevronRight className="h-5 w-5" />
        </button>

        <div ref={scrollRef} className="-mx-3 flex snap-x gap-4 overflow-x-auto px-3 py-3 [scrollbar-width:thin]">
          {addons.map((addon, i) => (
          <motion.div
            key={addon.uuid}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: Math.min(i * 0.04, 0.4), ease: 'easeOut' }}
            className="w-[260px] sm:w-[300px] shrink-0 snap-start"
          >
            <DiscoverCard
              addon={addon}
              saved={isSaved(addon)}
              saving={savingKey === addon.uuid}
              favorite={isFavorite?.(addon)}
              onSave={onSave}
              onDeploy={onDeploy}
              onConfigure={onConfigure}
              onOpenDetail={onOpenDetail}
              onToggleFavorite={onToggleFavorite}
              deployedCount={deployedCount}
              accountTotal={accountTotal}
            />
          </motion.div>
        ))}
        </div>
      </div>
    </section>
  )
}
