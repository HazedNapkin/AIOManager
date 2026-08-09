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
