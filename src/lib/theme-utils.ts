import type { ThemePalette } from '@/data/themes'

export function createCustomThemeId(): `custom-${string}` {
    // Themes also work on plain-HTTP self-hosted installs without randomUUID.
    const unique = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    return `custom-${unique}`
}

export function parseThemePalette(value: unknown): ThemePalette | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const source = value as Record<string, unknown>
    const required = ['background', 'card', 'cardForeground', 'primary', 'mutedForeground', 'muted', 'destructive', 'border'] as const
    const optional = ['input', 'ring', 'primaryForeground', 'destructiveForeground'] as const
    const isHsl = (entry: unknown) => {
        if (typeof entry !== 'string') return false
        const match = entry.trim().match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/)
        return !!match && Number(match[1]) <= 360 && Number(match[2]) <= 100 && Number(match[3]) <= 100
    }
    if (required.some(key => !isHsl(source[key]))) return null
    if (optional.some(key => source[key] !== undefined && !isHsl(source[key]))) return null
    // Color consumers split on spaces; normalize valid CSS whitespace first.
    const normalize = (color: string) => color.trim().replace(/\s+/g, ' ')
    return {
        ...Object.fromEntries([...required, ...optional]
            .filter(key => typeof source[key] === 'string')
            .map(key => [key, normalize(source[key] as string)])),
        input: normalize((source.input ?? source.border) as string),
        ring: normalize((source.ring ?? source.primary) as string),
    } as ThemePalette
}

interface CustomTheme {
    id: string
    label: string
    base: string
    hue: number
    saturation: number
    [key: string]: unknown
}

const VALID_BASES = ['dark', 'light', 'oled']

export function mergeCustomThemes(incoming: unknown[], existing: unknown[]): CustomTheme[] {
    const merged: CustomTheme[] = [...existing] as CustomTheme[]
    for (const ct of incoming) {
        if (!ct || typeof ct !== 'object') continue
        const candidate = ct as Record<string, unknown>
        if (typeof candidate.id !== 'string' || typeof candidate.label !== 'string') continue
        if (!VALID_BASES.includes(candidate.base as string)) continue
        if (typeof candidate.hue !== 'number' || candidate.hue < 0 || candidate.hue > 360) continue
        if (typeof candidate.saturation !== 'number') continue
        const existingIdx = merged.findIndex((t) => t.id === candidate.id)
        if (existingIdx >= 0) {
            merged[existingIdx] = ct as CustomTheme
        } else {
            merged.push(ct as CustomTheme)
        }
    }
    return merged
}

export function persistCustomThemes(merged: CustomTheme[]) {
    try {
        localStorage.setItem('aio-custom-themes', JSON.stringify(merged))
        window.dispatchEvent(new CustomEvent('aio-custom-themes-change', { detail: { themes: merged } }))
    } catch {}
}
