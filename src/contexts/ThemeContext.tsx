import { triggerSync } from '@/lib/sync-trigger'
import { createContext, useContext, useEffect, useState, useCallback, useMemo, ReactNode } from 'react'
import { useLocation } from 'react-router-dom'

// Re-export all types and data so existing imports from '@/contexts/ThemeContext' keep working
export { THEME_OPTIONS } from '@/data/themes'
export type { Theme, ThemePalette, ThemeOption, ThemePreview, CompactPalette } from '@/data/themes'

import type { Theme, ThemePalette, ThemeOption } from '@/data/themes'
import { THEME_OPTIONS as _THEME_OPTIONS, derivePreview } from '@/data/themes'
const THEME_OPTIONS = _THEME_OPTIONS

// ── Helpers ──────────────────────────────────────────────────────────────────

function hslToHex(hsl: string): string {
    const [h, s, l] = hsl.split(' ').map(v => parseFloat(v))
    const sl = s / 100, ll = l / 100
    const c = (1 - Math.abs(2 * ll - 1)) * sl
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
    const m = ll - c / 2
    let r = 0, g = 0, b = 0
    if (h < 60) { r = c; g = x }
    else if (h < 120) { r = x; g = c }
    else if (h < 180) { g = c; b = x }
    else if (h < 240) { g = x; b = c }
    else if (h < 300) { r = x; b = c }
    else { r = c; b = x }
    const toHex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0')
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function getLuminance(hex: string): number {
    const r = parseInt(hex.slice(1, 3), 16) / 255
    const g = parseInt(hex.slice(3, 5), 16) / 255
    const b = parseInt(hex.slice(5, 7), 16) / 255
    const lin = (c: number) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function computedForeground(backgroundHsl: string): string {
    return getLuminance(hslToHex(backgroundHsl)) < 0.18 ? '0 0% 100%' : '0 0% 0%'
}

// ── Theme Application ────────────────────────────────────────────────────────

function applyTheme(palette: ThemePalette) {
    const root = document.documentElement
    const priFg = palette.primaryForeground ?? computedForeground(palette.primary)
    const desFg = palette.destructiveForeground ?? computedForeground(palette.destructive)

    root.style.setProperty('--background', palette.background)
    root.style.setProperty('--foreground', palette.cardForeground)
    root.style.setProperty('--card', palette.card)
    root.style.setProperty('--card-foreground', palette.cardForeground)
    root.style.setProperty('--popover', palette.card)
    root.style.setProperty('--popover-foreground', palette.cardForeground)
    root.style.setProperty('--primary', palette.primary)
    root.style.setProperty('--primary-foreground', priFg)
    root.style.setProperty('--secondary', palette.muted)
    root.style.setProperty('--secondary-foreground', palette.cardForeground)
    root.style.setProperty('--muted', palette.muted)
    root.style.setProperty('--muted-foreground', palette.mutedForeground)
    root.style.setProperty('--accent', palette.muted)
    root.style.setProperty('--accent-foreground', palette.cardForeground)
    root.style.setProperty('--destructive', palette.destructive)
    root.style.setProperty('--destructive-foreground', desFg)
    root.style.setProperty('--border', palette.border)
    root.style.setProperty('--input', palette.input)
    root.style.setProperty('--ring', palette.ring)
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
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

const STORAGE_KEY = 'aioman-theme'

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
        return getLuminance(hslToHex(themeOption.palette.background)) > 0.18
    }, [theme, getAllThemeOptions])

    // Apply theme whenever it changes
    useEffect(() => {
        if (isDocs) {
            if (isLight) {
                // Docs Isolation Palette (Neutral Light)
                applyTheme({
                    background: '0 0% 100%',
                    card: '0 0% 100%',
                    cardForeground: '240 10% 3.9%',
                    primary: '45 93% 47%',
                    muted: '240 4.8% 95.9%',
                    mutedForeground: '240 3.8% 46.1%',
                    border: '240 5.9% 90%',
                    input: '240 5.9% 90%',
                    ring: '45 100% 50%',
                    destructive: '0 84% 60%',
                })
                document.documentElement.setAttribute('data-theme', 'light')
            } else {
                // Docs Isolation Palette (Neutral Dark)
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
            }
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
            applyTheme(themeOption.palette)
            document.documentElement.setAttribute('data-theme', theme)

            const metaThemeColor = document.querySelector('meta[name="theme-color"]')
            if (metaThemeColor) {
                metaThemeColor.setAttribute('content', themeOption.preview.background)
            }

            const customTheme = customThemes.find(t => t.id === theme)
            const cssContent = customTheme?.customCss?.trim() || themeOption.customCss?.trim()
            const existingStyleEl = document.getElementById('aioman-custom-theme-css')
            if (cssContent) {
                if (existingStyleEl) {
                    existingStyleEl.textContent = cssContent
                } else {
                    const styleEl = document.createElement('style')
                    styleEl.id = 'aioman-custom-theme-css'
                    styleEl.textContent = cssContent
                    document.head.appendChild(styleEl)
                }
            } else if (existingStyleEl) {
                existingStyleEl.remove()
            }
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
            const allOptions = getAllThemeOptions()
            const themeOption = allOptions.find(t => t.id === theme)
            if (themeOption) {
                applyTheme(themeOption.palette)
                document.documentElement.setAttribute('data-theme', theme)
            }
        }
        window.addEventListener('aio-theme-reapply', handleReapply)
        return () => window.removeEventListener('aio-theme-reapply', handleReapply)
    }, [theme, getAllThemeOptions])

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
        try { localStorage.setItem(STORAGE_KEY, newTheme) } catch { /* storage unavailable */ }
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
        getAllThemeOptions, isLight
    }), [theme, setTheme, customThemes, addCustomTheme, updateCustomTheme, deleteCustomTheme, getAllThemeOptions, isLight])

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
