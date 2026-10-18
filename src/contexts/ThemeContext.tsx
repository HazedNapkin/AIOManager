import { triggerSync } from '@/lib/sync-trigger'
import { createContext, useContext, useEffect, useState, useCallback, useMemo, ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { isLightPalette, themeVariables } from '@/lib/theme-styles'

// Re-export all types and data so existing imports from '@/contexts/ThemeContext' keep working
export { THEME_OPTIONS } from '@/data/themes'
export type { Theme, ThemePalette, ThemeOption, ThemePreview, CompactPalette } from '@/data/themes'

import type { Theme, ThemePalette, ThemeOption } from '@/data/themes'
import { THEME_OPTIONS as _THEME_OPTIONS, derivePreview } from '@/data/themes'
const THEME_OPTIONS = _THEME_OPTIONS

// ── Theme Application ────────────────────────────────────────────────────────

function applyTheme(palette: ThemePalette) {
    const root = document.documentElement
    for (const [key, value] of Object.entries(themeVariables(palette))) {
        root.style.setProperty(key, value)
    }
}

function applyThemeOption(option: ThemeOption) {
    applyTheme(option.palette)
    document.documentElement.setAttribute('data-theme', option.id)
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', option.preview.background)
    const existingStyle = document.getElementById('aioman-custom-theme-css')
    const css = option.customCss?.trim()
    if (!css) {
        existingStyle?.remove()
        return
    }
    const style = existingStyle ?? document.createElement('style')
    style.id = 'aioman-custom-theme-css'
    style.textContent = css
    if (!existingStyle) document.head.appendChild(style)
}

// ── Custom Theme Storage ─────────────────────────────────────────────────────

const CUSTOM_THEMES_KEY = 'aio-custom-themes'

export interface CustomThemeData {
    id: Theme
    label: string
    description?: string
    emoji: string
    base: 'dark' | 'light' | 'oled'
    hue: number
    saturation: number
    palette: ThemePalette
    customCss?: string
    logoUrl?: string
}

function loadCustomThemes(): CustomThemeData[] {
    try {
        const raw = localStorage.getItem(CUSTOM_THEMES_KEY)
        return raw ? JSON.parse(raw) : []
    } catch {
        return []
    }
}

function saveCustomThemes(themes: CustomThemeData[]) {
    try {
        localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(themes))
    } catch {
        // Storage unavailable (e.g. Safari private mode)
    }
}

function customToOption(ct: CustomThemeData): ThemeOption {
    return {
        id: ct.id,
        label: ct.label,
        description: ct.description || `Custom ${ct.base} theme`,
        emoji: ct.emoji,
        category: 'standard' as const,
        palette: ct.palette,
        preview: derivePreview(ct.palette),
        customCss: ct.customCss,
        logoUrl: ct.logoUrl,
    }
}

// ── Context ──────────────────────────────────────────────────────────────────

interface ThemeContextType {
    theme: Theme
    setTheme: (theme: Theme) => void
    customThemes: CustomThemeData[]
    addCustomTheme: (data: CustomThemeData) => void
    updateCustomTheme: (id: Theme, data: CustomThemeData) => void
    deleteCustomTheme: (id: Theme) => void
    getAllThemeOptions: () => ThemeOption[]
    isLight: boolean
    logoUrl: string | undefined
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

const STORAGE_KEY = 'aioman-theme'

// Builtin themes removed from the catalog. A saved selection matching one of
// these resolves to its fallback so the app never starts on a missing theme.
// Custom clones use `custom-*` ids and are unaffected.
const REMOVED_BUILTIN_THEMES = new Map<string, Theme>([
    ['borderlands', 'dark'],
    ['deep-orbit', 'dark'],
    ['cupertino', 'dark'],
    ['cupertino-dark', 'dark'],
])

export function ThemeProvider({ children }: { children: ReactNode }) {
    const [customThemes, setCustomThemes] = useState<CustomThemeData[]>(loadCustomThemes)

    const getAllThemeOptions = useCallback((): ThemeOption[] => {
        return [...THEME_OPTIONS, ...customThemes.map(customToOption)]
    }, [customThemes])

    const location = useLocation()
    const isDocs = location.pathname.startsWith('/kronorium')

    const [theme, setThemeState] = useState<Theme>(() => {
        try {
            let saved = localStorage.getItem(STORAGE_KEY) as string | null
            const migrated = localStorage.getItem('aio-theme-migrated-v2')
            if (!migrated) {
                if (saved === 'midnight') { saved = 'dark' }
                if (saved) {
                    localStorage.setItem(STORAGE_KEY, saved)
                    localStorage.setItem('aio-theme-migrated-v2', '1')
                }
            }
            const migratedV3 = localStorage.getItem('aio-theme-migrated-v3')
            if (!migratedV3 && saved) {
                if (saved === 'synthwave-84') {
                    saved = 'synthwave'
                    localStorage.setItem(STORAGE_KEY, saved)
                }
                localStorage.setItem('aio-theme-migrated-v3', '1')
            }
            // Repair saved selections that point at removed builtins (e.g. an
            // old 'borderlands' pick, or one synced back from another device).
            if (saved) {
                const replacement = REMOVED_BUILTIN_THEMES.get(saved)
                if (replacement) {
                    saved = replacement
                    localStorage.setItem(STORAGE_KEY, saved)
                }
            }
            const allOptions = [...THEME_OPTIONS, ...loadCustomThemes().map(customToOption)]
            const match = saved ? allOptions.find(t => t.id === saved) : undefined
            return (match ? saved : 'dark') as Theme
        } catch {
            return 'dark'
        }
    })

    const isLight = useMemo(() => {
        const allOptions = getAllThemeOptions()
        const themeOption = allOptions.find(t => t.id === theme)
        if (!themeOption) return false
        return isLightPalette(themeOption.palette)
    }, [theme, getAllThemeOptions])

    const logoUrl = useMemo(() => {
        const allOptions = getAllThemeOptions()
        const themeOption = allOptions.find(t => t.id === theme)
        return themeOption?.logoUrl
    }, [theme, getAllThemeOptions])

    // Apply theme whenever it changes
    useEffect(() => {
        if (isDocs) {
            document.getElementById('aioman-custom-theme-css')?.remove()
            // Match Kronorium's forced dark layout, including body-level portals.
            applyTheme({
                background: '0 0% 0%',
                card: '240 10% 2%',
                cardForeground: '0 0% 98%',
                primary: '45 93% 47%',
                muted: '240 5% 15%',
                mutedForeground: '240 5% 65%',
                border: '240 5% 12%',
                input: '240 5% 12%',
                ring: '45 100% 50%',
                destructive: '0 84% 60%',
            })
            document.documentElement.setAttribute('data-theme', 'dark')
            document.documentElement.classList.add('kronorium-active')
            return
        }

        // Leaving docs → aggressively clean up Fumadocs residue
        document.documentElement.classList.remove('kronorium-active')
        // Remove any data-theme set by Fumadocs RootProvider on <html>
        document.documentElement.removeAttribute('data-theme')

        const allOptions = getAllThemeOptions()
        const themeOption = allOptions.find(t => t.id === theme)
        if (themeOption) {
            applyThemeOption(themeOption)
        } else {
            const existingStyleEl = document.getElementById('aioman-custom-theme-css')
            if (existingStyleEl) existingStyleEl.remove()
        }
    }, [theme, customThemes, getAllThemeOptions, isDocs, isLight])

    // Storage event listener for cross-tab or cross-sync reactivity (fix for incognito cloud pull)
    useEffect(() => {
        const handleStorage = (e: StorageEvent | CustomEvent) => {
            const newValue = (e as StorageEvent).newValue ?? (e as CustomEvent).detail?.value
            const key = (e as StorageEvent).key ?? STORAGE_KEY
            if (key !== STORAGE_KEY || !newValue) return
            const allOptions = getAllThemeOptions()
            if (allOptions.find(t => t.id === newValue)) {
                setThemeState(newValue as Theme)
            } else {
                const replacement = REMOVED_BUILTIN_THEMES.get(newValue)
                if (replacement) {
                    // A removed builtin arrived from another tab or device:
                    // fall back to its replacement and repair local storage.
                    // Unknown ids (custom clones not synced here yet) stay untouched.
                    setThemeState(replacement)
                    try { localStorage.setItem(STORAGE_KEY, replacement) } catch {}
                }
            }
        }
        window.addEventListener('storage', handleStorage as EventListener)
        window.addEventListener('aio-theme-change', handleStorage as EventListener)
        return () => {
            window.removeEventListener('storage', handleStorage as EventListener)
            window.removeEventListener('aio-theme-change', handleStorage as EventListener)
        }
    }, [getAllThemeOptions])

    useEffect(() => {
        const handleReapply = () => {
            if (isDocs) return
            const allOptions = getAllThemeOptions()
            const themeOption = allOptions.find(t => t.id === theme)
            if (themeOption) {
                applyThemeOption(themeOption)
            }
        }
        window.addEventListener('aio-theme-reapply', handleReapply)
        return () => window.removeEventListener('aio-theme-reapply', handleReapply)
    }, [theme, getAllThemeOptions, isDocs])

    useEffect(() => {
        const handleCustomThemesSync = (e: CustomEvent) => {
            if (!e.detail?.themes) return
            setCustomThemes(e.detail.themes)
        }
        window.addEventListener('aio-custom-themes-change', handleCustomThemesSync as EventListener)
        return () => window.removeEventListener('aio-custom-themes-change', handleCustomThemesSync as EventListener)
    }, [])

    const setTheme = useCallback((newTheme: Theme) => {
        setThemeState(newTheme)
        try { localStorage.setItem(STORAGE_KEY, newTheme) } catch {}
        triggerSync()
    }, [])

    const addCustomTheme = useCallback((data: CustomThemeData) => {
        setCustomThemes(prev => {
            const next = [...prev, data]
            saveCustomThemes(next)
            triggerSync()
            return next
        })
    }, [])

    const updateCustomTheme = useCallback((id: Theme, data: CustomThemeData) => {
        setCustomThemes(prev => {
            const next = prev.map(t => t.id === id ? data : t)
            saveCustomThemes(next)
            triggerSync()
            return next
        })
    }, [])

    const deleteCustomTheme = useCallback((id: Theme) => {
        setCustomThemes(prev => {
            const next = prev.filter(t => t.id !== id)
            saveCustomThemes(next)
            triggerSync()
            return next
        })
        // If current theme is the deleted one, fall back
        if (theme === id) {
            setTheme('dark')
        }
    }, [theme, setTheme])

    const contextValue = useMemo(() => ({
        theme, setTheme,
        customThemes, addCustomTheme, updateCustomTheme, deleteCustomTheme,
        getAllThemeOptions, isLight, logoUrl
    }), [theme, setTheme, customThemes, addCustomTheme, updateCustomTheme, deleteCustomTheme, getAllThemeOptions, isLight, logoUrl])

    return (
        <ThemeContext.Provider value={contextValue}>
            {children}
        </ThemeContext.Provider>
    )
}

export function useTheme() {
    const context = useContext(ThemeContext)
    if (!context) {
        throw new Error('useTheme must be used within a ThemeProvider')
    }
    return context
}
