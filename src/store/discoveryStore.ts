import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface DiscoveryPreferences {
    obscurity: 'popular' | 'balanced' | 'hidden' | 'gems' | 'obscure' | 'all'
    minRating: number
    eraRange: { from: number; to: number }
    typeMix: 'movies' | 'series' | 'both'
    genreBoosts: Record<string, number>
    excludedGenres: string[]
    dismissedItems: string[]
    lovedItems: string[]
}

export const DISCOVERY_DEFAULTS: DiscoveryPreferences = {
    obscurity: 'all',
    minRating: 0,
    eraRange: { from: 1900, to: new Date().getFullYear() },
    typeMix: 'both',
    genreBoosts: {},
    excludedGenres: [],
    dismissedItems: [],
    lovedItems: [],
}

export const HOUSEHOLD_CONTEXT = 'household'
export const CONTINUE_WATCHING_CONTEXT = 'continue-watching'

interface HouseholdSettings {
    enabledAccounts: string[] | 'all'
    mergeMode: 'union' | 'intersection'
}

interface DiscoveryStore {
    contexts: Record<string, DiscoveryPreferences>
    household: HouseholdSettings

    getPrefs: (context: string) => DiscoveryPreferences
    updatePrefs: (context: string, updates: Partial<DiscoveryPreferences>) => void
    setObscurity: (context: string, v: DiscoveryPreferences['obscurity']) => void
    setMinRating: (context: string, v: number) => void
    setEraRange: (context: string, from: number, to: number) => void
    setTypeMix: (context: string, v: DiscoveryPreferences['typeMix']) => void
    setGenreBoost: (context: string, genre: string, multiplier: number) => void
    removeGenreBoost: (context: string, genre: string) => void
    toggleExcludedGenre: (context: string, genre: string) => void
    dismissItem: (context: string, itemId: string) => void
    undismissItem: (context: string, itemId: string) => void
    loveItem: (context: string, itemId: string) => void
    unloveItem: (context: string, itemId: string) => void
    resetContext: (context: string) => void

    setEnabledAccounts: (ids: string[] | 'all') => void
    setMergeMode: (v: 'union' | 'intersection') => void
}

function prefsForContext(contexts: Record<string, DiscoveryPreferences>, context: string): DiscoveryPreferences {
    return contexts[context] || DISCOVERY_DEFAULTS
}

export const useDiscoveryStore = create<DiscoveryStore>()(
    persist(
        (set, get) => ({
            contexts: {},
            household: {
                enabledAccounts: 'all',
                mergeMode: 'union',
            },

            getPrefs: (context) => prefsForContext(get().contexts, context),

            updatePrefs: (context, updates) => set((state) => ({
                contexts: {
                    ...state.contexts,
                    [context]: { ...prefsForContext(state.contexts, context), ...updates },
                },
            })),

            setObscurity: (context, v) => get().updatePrefs(context, { obscurity: v }),
            setMinRating: (context, v) => get().updatePrefs(context, { minRating: v }),
            setEraRange: (context, from, to) => get().updatePrefs(context, { eraRange: { from, to } }),
            setTypeMix: (context, v) => get().updatePrefs(context, { typeMix: v }),

            setGenreBoost: (context, genre, multiplier) => set((state) => {
                const prefs = prefsForContext(state.contexts, context)
                return {
                    contexts: {
                        ...state.contexts,
                        [context]: {
                            ...prefs,
                            genreBoosts: { ...prefs.genreBoosts, [genre]: multiplier },
                        },
                    },
                }
            }),

            removeGenreBoost: (context, genre) => set((state) => {
                const prefs = prefsForContext(state.contexts, context)
                const newGenreBoosts = { ...prefs.genreBoosts }
                delete newGenreBoosts[genre]
                return {
                    contexts: {
                        ...state.contexts,
                        [context]: { ...prefs, genreBoosts: newGenreBoosts },
                    },
                }
            }),

            toggleExcludedGenre: (context, genre) => set((state) => {
                const prefs = prefsForContext(state.contexts, context)
                return {
                    contexts: {
                        ...state.contexts,
                        [context]: {
                            ...prefs,
                            excludedGenres: prefs.excludedGenres.includes(genre)
                                ? prefs.excludedGenres.filter((g) => g !== genre)
                                : [...prefs.excludedGenres, genre],
                        },
                    },
                }
            }),

            dismissItem: (context, itemId) => set((state) => {
                const prefs = prefsForContext(state.contexts, context)
                return {
                    contexts: {
                        ...state.contexts,
                        [context]: {
                            ...prefs,
                            dismissedItems: prefs.dismissedItems.includes(itemId)
                                ? prefs.dismissedItems
                                : [...prefs.dismissedItems, itemId],
                        },
                    },
                }
            }),

            undismissItem: (context, itemId) => set((state) => {
                const prefs = prefsForContext(state.contexts, context)
                return {
                    contexts: {
                        ...state.contexts,
                        [context]: {
                            ...prefs,
                            dismissedItems: prefs.dismissedItems.filter((id) => id !== itemId),
                        },
                    },
                }
            }),

            loveItem: (context, itemId) => set((state) => {
                const prefs = prefsForContext(state.contexts, context)
                return {
                    contexts: {
                        ...state.contexts,
                        [context]: {
                            ...prefs,
                            lovedItems: prefs.lovedItems.includes(itemId)
                                ? prefs.lovedItems
                                : [...prefs.lovedItems, itemId],
                            dismissedItems: prefs.dismissedItems.filter((id) => id !== itemId),
                        },
                    },
                }
            }),

            unloveItem: (context, itemId) => set((state) => {
                const prefs = prefsForContext(state.contexts, context)
                return {
                    contexts: {
                        ...state.contexts,
                        [context]: {
                            ...prefs,
                            lovedItems: prefs.lovedItems.filter((id) => id !== itemId),
                        },
                    },
                }
            }),

            resetContext: (context) => set((state) => ({
                contexts: {
                    ...state.contexts,
                    [context]: { ...DISCOVERY_DEFAULTS },
                },
            })),

            setEnabledAccounts: (ids) => set((state) => ({
                household: { ...state.household, enabledAccounts: ids },
            })),

            setMergeMode: (v) => set((state) => ({
                household: { ...state.household, mergeMode: v },
            })),
        }),
        {
            name: 'aiomanager:discovery-preferences',
            version: 2,
            migrate: (persisted: unknown, version: number) => {
                if (!persisted || typeof persisted !== 'object') return persisted
                const old = persisted as Record<string, unknown>
                if (version < 2) {
                    const oldPrefs: Partial<DiscoveryPreferences> = {}
                    const fields: (keyof DiscoveryPreferences)[] = [
                        'obscurity', 'minRating', 'eraRange', 'typeMix',
                        'genreBoosts', 'excludedGenres', 'dismissedItems', 'lovedItems',
                    ]
                    for (const f of fields) {
                        if (f in old) oldPrefs[f] = old[f] as never
                    }
                    const household: HouseholdSettings = {
                        enabledAccounts: (old.enabledAccounts as string[] | 'all') || 'all',
                        mergeMode: (old.mergeMode as 'union' | 'intersection') || 'union',
                    }
                    return {
                        contexts: oldPrefs.obscurity ? { household: { ...DISCOVERY_DEFAULTS, ...oldPrefs } } : {},
                        household,
                    }
                }
                return persisted
            },
        },
    ),
)

export function useDiscoveryPrefs(context: string = HOUSEHOLD_CONTEXT): DiscoveryPreferences {
    return useDiscoveryStore((s) => prefsForContext(s.contexts, context))
}

export function useHouseholdSettings(): HouseholdSettings {
    return useDiscoveryStore((s) => s.household)
}
