import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Check, ChevronLeft, ChevronRight, Plus, Settings2, Star, Upload } from 'lucide-react'
import { getConfigureUrl, requiresConfiguration, type DiscoverAddon } from '@/api/discover'

interface DiscoverHeroProps {
  addons: DiscoverAddon[]
  isSaved: (addon: DiscoverAddon) => boolean
  savingKey: string | null
  onSave: (addon: DiscoverAddon) => void
  onConfigure: (addon: DiscoverAddon) => void
  onOpenDetail: (addon: DiscoverAddon) => void
  onDeploy?: (addon: DiscoverAddon) => void
  deployedCount?: (addon: DiscoverAddon) => number
  accountTotal?: number
}

const ROTATE_MS = 7000

export function DiscoverHero({ addons, isSaved, savingKey, onSave, onConfigure, onOpenDetail, onDeploy, deployedCount }: DiscoverHeroProps) {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [failedBackgrounds, setFailedBackgrounds] = useState<Set<string>>(new Set())
  const [failedLogos, setFailedLogos] = useState<Set<string>>(new Set())

  const count = addons.length
  const active = count > 0 ? index % count : 0

  useEffect(() => { setIndex(0) }, [count])

  useEffect(() => {
    if (paused || count <= 1) return
    const id = setInterval(() => setIndex((i) => (i + 1) % count), ROTATE_MS)
    return () => clearInterval(id)
  }, [paused, count])

  if (count === 0) return null

  const go = (delta: number) => setIndex((i) => (i + delta + count) % count)

  const addon = addons[active]
  const manifest = addon.manifest ?? ({} as DiscoverAddon['manifest'])
  const name = manifest.name?.trim() || addon.slug
  const description = manifest.description?.trim() || ''
  const background = manifest.background
  const logo = manifest.logo
  const needsConfig = requiresConfiguration(addon)
  const canConfigure = !!getConfigureUrl(addon)
  const saved = isSaved(addon)
  const deployedOn = deployedCount?.(addon) ?? 0
  
  const showBackground = background && !failedBackgrounds.has(addon.uuid)
  const showLogo = logo && !failedLogos.has(addon.uuid)

  return (
    <div
      className="group relative h-[240px] cursor-pointer overflow-hidden rounded-xl border border-border/40 shadow-sm"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onClick={() => onOpenDetail(addon)}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={addon.uuid}
          initial={{ opacity: 0, scale: 1.04 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="absolute inset-0"
        >
          {showBackground ? (
            <img 
              src={background!} 
              alt="" 
              className="absolute inset-0 h-full w-full object-cover" 
              onError={() => setFailedBackgrounds(prev => new Set(prev).add(addon.uuid))} 
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-primary/30 via-primary/10 to-background" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/85 to-background/30" />
        </motion.div>
      </AnimatePresence>

      <div className="relative flex h-full flex-col justify-end gap-2.5 p-5 sm:p-7">
        <motion.div
          key={`${addon.uuid}-content`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="flex flex-col gap-2.5"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border/50 bg-card/80 shadow-lg backdrop-blur">
              {showLogo ? (
                <img 
                  src={logo!} 
                  alt="" 
                  className="h-full w-full object-contain" 
                  onError={() => setFailedLogos(prev => new Set(prev).add(addon.uuid))} 
                />
              ) : (
                <span className="text-lg font-bold text-muted-foreground">{name.charAt(0).toUpperCase()}</span>
              )}
            </div>
            <div className="min-w-0">
              <span className="text-xs font-bold uppercase tracking-wider text-primary">Featured</span>
              <h2 className="truncate text-2xl font-bold tracking-tight sm:text-3xl">{name}</h2>
            </div>
          </div>

          {description && <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground line-clamp-2">{description}</p>}

          <div className="flex flex-wrap items-center gap-3" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <span className="flex items-center gap-1 text-sm font-semibold">
              <Star className="h-4 w-4 fill-warning text-warning" />
              {addon.stars.toLocaleString()}
            </span>
            {deployedOn > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                <Upload className="h-3 w-3" />
                On {deployedOn} account{deployedOn !== 1 ? 's' : ''}
              </span>
            )}
            {needsConfig ? (
              <Button className="gap-1.5" onClick={() => onConfigure(addon)}>
                <Settings2 className="h-4 w-4" />
                Configure
              </Button>
            ) : onDeploy ? (
              <Button className="gap-1.5" onClick={() => onDeploy(addon)}>
                <Upload className="h-4 w-4" />
                Install to accounts
              </Button>
            ) : (
              <Button className="gap-1.5" onClick={() => onSave(addon)} disabled={savingKey === addon.uuid}>
                <Plus className="h-4 w-4" />
                {savingKey === addon.uuid ? 'Saving...' : 'Save to Library'}
              </Button>
            )}
            {saved ? (
              <Button variant="outline" disabled className="gap-1.5">
                <Check className="h-4 w-4" />
                In Library
              </Button>
            ) : !needsConfig && onDeploy ? (
              <Button variant="outline" className="gap-1.5" onClick={() => onSave(addon)} disabled={savingKey === addon.uuid}>
                <Plus className="h-4 w-4" />
                {savingKey === addon.uuid ? 'Saving...' : 'Save'}
              </Button>
            ) : null}
            {!needsConfig && canConfigure && (
              <Button variant="outline" className="gap-1.5" onClick={() => onConfigure(addon)}>
                <Settings2 className="h-4 w-4" />
                Configure
              </Button>
            )}
          </div>
        </motion.div>
      </div>

      {count > 1 && (
        <>
          <button
            type="button"
            aria-label="Previous featured addon"
            onClick={(e) => { e.stopPropagation(); go(-1) }}
            className="absolute left-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-border/40 bg-card/70 text-foreground/80 shadow-lg backdrop-blur transition-colors hover:bg-card"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="Next featured addon"
            onClick={(e) => { e.stopPropagation(); go(1) }}
            className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-border/40 bg-card/70 text-foreground/80 shadow-lg backdrop-blur transition-colors hover:bg-card"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
          <div className="absolute bottom-3 right-4 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            {addons.map((a, i) => (
              <button
                key={a.uuid}
                type="button"
                aria-label={`Featured ${i + 1}`}
                onClick={() => setIndex(i)}
                className={cn('h-1.5 rounded-full transition-all', i === active ? 'w-5 bg-primary' : 'w-1.5 bg-foreground/30 hover:bg-foreground/50')}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
