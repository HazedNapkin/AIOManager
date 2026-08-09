import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface DiscoveryPreferences {
  obscurity: 'popular' | 'balanced' | 'hidden' | 'gems' | 'obscure' | 'all'
  minRating: number
  eraRange: { from: number; to: number }
  typeMix: 'movies' | 'series' | 'both'
  genreBoosts: Record<string, number>
  excludedGenres: string[]
  enabledAccounts: string[] | 'all'
  mergeMode: 'union' | 'intersection'
  dismissedItems: string[]
  lovedItems: string[]
}

interface DiscoveryStore extends DiscoveryPreferences {
  setObscurity: (v: DiscoveryPreferences['obscurity']) => void
  setMinRating: (v: number) => void
  setEraRange: (from: number, to: number) => void
  setTypeMix: (v: DiscoveryPreferences['typeMix']) => void
  setGenreBoost: (genre: string, multiplier: number) => void
  removeGenreBoost: (genre: string) => void
  toggleExcludedGenre: (genre: string) => void
  setEnabledAccounts: (ids: string[] | 'all') => void
  setMergeMode: (v: 'union' | 'intersection') => void
  dismissItem: (itemId: string) => void
  undismissItem: (itemId: string) => void
  loveItem: (itemId: string) => void
  unloveItem: (itemId: string) => void
  resetToDefaults: () => void
}

const DEFAULTS: DiscoveryPreferences = {
  obscurity: 'hidden',
  minRating: 6.0,
  eraRange: { from: 1990, to: new Date().getFullYear() },
  typeMix: 'both',
  genreBoosts: {},
  excludedGenres: [],
  enabledAccounts: 'all',
  mergeMode: 'union',
  dismissedItems: [],
  lovedItems: [],
}

export const useDiscoveryStore = create<DiscoveryStore>()(
  persist(
    (set) => ({
      ...DEFAULTS,

      setObscurity: (v) => set({ obscurity: v }),

      setMinRating: (v) => set({ minRating: v }),

      setEraRange: (from, to) => set({ eraRange: { from, to } }),

      setTypeMix: (v) => set({ typeMix: v }),

      setGenreBoost: (genre, multiplier) => set((state) => ({
        genreBoosts: { ...state.genreBoosts, [genre]: multiplier },
      })),

      removeGenreBoost: (genre) => set((state) => {
        const newGenreBoosts = { ...state.genreBoosts }
        delete newGenreBoosts[genre]
        return { genreBoosts: newGenreBoosts }
      }),

      toggleExcludedGenre: (genre) => set((state) => ({
        excludedGenres: state.excludedGenres.includes(genre)
          ? state.excludedGenres.filter((g) => g !== genre)
          : [...state.excludedGenres, genre],
      })),

      setEnabledAccounts: (ids) => set({ enabledAccounts: ids }),

      setMergeMode: (v) => set({ mergeMode: v }),

      dismissItem: (itemId) => set((state) => ({
        dismissedItems: state.dismissedItems.includes(itemId)
          ? state.dismissedItems
          : [...state.dismissedItems, itemId],
      })),

      undismissItem: (itemId) => set((state) => ({
        dismissedItems: state.dismissedItems.filter((id) => id !== itemId),
      })),

      loveItem: (itemId) => set((state) => {
        const newState = {
          lovedItems: state.lovedItems.includes(itemId)
            ? state.lovedItems
            : [...state.lovedItems, itemId],
          dismissedItems: state.dismissedItems.filter((id) => id !== itemId),
        }
        return newState
      }),

      unloveItem: (itemId) => set((state) => ({
        lovedItems: state.lovedItems.filter((id) => id !== itemId),
      })),

      resetToDefaults: () => set(DEFAULTS),
    }),
    {
      name: 'aiomanager:discovery-preferences',
    },
  ),
)