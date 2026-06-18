export type RarityTier = 'common' | 'rare' | 'epic' | 'legendary'

export interface RarityConfig {
  label: string
  color: string
  glowColor: string
  shimmer: boolean
  confetti: boolean
  confettiColors: string[]
}

export const RARITY_CONFIGS: Record<RarityTier, RarityConfig> = {
  common: {
    label: 'Common',
    color: '#94a3b8',
    glowColor: 'rgba(148,163,184,0.15)',
    shimmer: false,
    confetti: false,
    confettiColors: [],
  },
  rare: {
    label: 'Rare',
    color: '#3b82f6',
    glowColor: 'rgba(59,130,246,0.2)',
    shimmer: false,
    confetti: false,
    confettiColors: [],
  },
  epic: {
    label: 'Epic',
    color: '#a855f7',
    glowColor: 'rgba(168,85,247,0.25)',
    shimmer: true,
    confetti: true,
    confettiColors: ['#a855f7', '#c084fc', '#e9d5ff', '#f0abfc'],
  },
  legendary: {
    label: 'Legendary',
    color: '#f59e0b',
    glowColor: 'rgba(245,158,11,0.3)',
    shimmer: true,
    confetti: true,
    confettiColors: ['#f59e0b', '#fbbf24', '#fcd34d', '#fef3c7', '#fde68a'],
  },
}

export function getRarity(stars: number | undefined | null): RarityTier {
  if (!stars || stars < 50) return 'common'
  if (stars < 200) return 'rare'
  if (stars < 1000) return 'epic'
  return 'legendary'
}

export function getRarityConfig(stars: number | undefined | null): RarityConfig {
  return RARITY_CONFIGS[getRarity(stars)]
}

export function countByRarity(addons: Array<{ stars?: number }>): Record<RarityTier, number> {
  const counts: Record<RarityTier, number> = { common: 0, rare: 0, epic: 0, legendary: 0 }
  for (const addon of addons) {
    counts[getRarity(addon.stars)]++
  }
  return counts
}