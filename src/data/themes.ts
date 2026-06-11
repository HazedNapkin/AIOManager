// ─────────────────────────────────────────────────────────────────────────────
// Theme Definitions
// ─────────────────────────────────────────────────────────────────────────────
// All theme data lives here. The ThemeContext only contains provider logic.
//
// AUTHORING A NEW THEME
// 1. Add the id to the Theme union type
// 2. Add an entry to THEME_DEFS with a CompactPalette (8-9 fields)
// 3. That's it - `input`, `ring`, and preview hex are auto-derived.
//    Override `ring` only if it differs from `primary`.
// ─────────────────────────────────────────────────────────────────────────────

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Convert an "H S% L%" string to a hex color. */
export function hslToHex(hsl: string): string {
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

// ── Types ────────────────────────────────────────────────────────────────────

export type Theme =
    | 'light'
    | 'dark'
    | 'nightfall'
    | 'aurora'
    | 'aubergine'
    | 'rose-gold'
    | 'ochin'
    | 'choco-mint'
    | 'cafe'
    | 'hoth'
    | 'sunset'
    | 'cyberpunk'
    | 'synthwave'
    | 'dracula'
    | 'nord'
    | 'torbox'
    | 'real-debrid'
    | 'alldebrid'
    | 'premiumize'
    | 'aiostreams'
    | 'comet'
    | 'elfhosted'
    | 'stremio'
    | 'trakt'
    | 'simkl'
    | 'sonic'
    | 'catppuccin-latte'
    | 'catppuccin-frappe'
    | 'catppuccin-macchiato'
    | 'catppuccin-mocha'
    | 'tokyo-night'
    | 'gruvbox-dark'
    | 'one-dark-pro'
    | 'monokai-pro'
    | 'night-owl'
    | 'solarized-dark'
    | 'rose-pine'
    | 'synthwave-84'
    | 'ayu-mirage'
    | 'cobalt2'
    | 'material-palenight'
    | 'github-dark-dimmed'
    | 'everforest'
    | 'kanagawa'
    | 'parchment'
    | 'high-contrast'
    | 'mermaid'
    | 'ember'
    | 'obsidian-gold'
    | 'clinical-mint'
    | 'crimson'
    | 'amber-glass'
    | 'slate-mono'
    | 'deep-space'
    | 'parchment-dusk'
    | 'parchment-dark'
    | 'vellum'
    | 'sepia'
    | 'manuscript'
    | 'linen'
    | 'driftwood'
    | 'infrared'
    | `custom-${string}`

/** Full palette used by applyTheme - 10 CSS variable targets. */
export interface ThemePalette {
    background: string
    card: string
    cardForeground: string
    primary: string
    primaryForeground?: string
    mutedForeground: string
    muted: string
    destructive: string
    destructiveForeground?: string
    border: string
    input: string
    ring: string
}

/** Compact authoring format - `input` and `ring` are auto-derived. */
export interface CompactPalette {
    background: string
    card: string
    cardForeground: string
    primary: string
    primaryForeground?: string
    mutedForeground: string
    muted: string
    destructive: string
    destructiveForeground?: string
    border: string
    /** Override only if ring differs from primary (rare). */
    ring?: string
}

export interface ThemePreview {
    background: string
    surface: string
    accent: string
    text: string
    textMuted: string
}

export interface ThemeOption {
    id: Theme
    label: string
    description: string
    emoji: string
    italic?: boolean
    category: 'standard' | 'community'
    subcategory?: 'light' | 'dark' | 'oled'
    palette: ThemePalette
    preview: ThemePreview
}

// ── Internal builders ────────────────────────────────────────────────────────

export function expand(c: CompactPalette): ThemePalette {
    return {
        background: c.background,
        card: c.card,
        cardForeground: c.cardForeground,
        primary: c.primary,
        primaryForeground: c.primaryForeground,
        mutedForeground: c.mutedForeground,
        muted: c.muted,
        destructive: c.destructive,
        destructiveForeground: c.destructiveForeground,
        border: c.border,
        input: c.border,
        ring: c.ring ?? c.primary,
    }
}

export function derivePreview(p: ThemePalette): ThemePreview {
    return {
        background: hslToHex(p.background),
        surface: hslToHex(p.card),
        accent: hslToHex(p.primary),
        text: hslToHex(p.cardForeground),
        textMuted: hslToHex(p.mutedForeground),
    }
}

function theme(
    id: Theme,
    label: string,
    description: string,
    emoji: string,
    category: 'standard' | 'community',
    compact: CompactPalette,
    opts?: { italic?: boolean; subcategory?: 'light' | 'dark' | 'oled' },
): ThemeOption {
    const palette = expand(compact)
    return {
        id,
        label,
        description,
        emoji,
        category,
        palette,
        preview: derivePreview(palette),
        ...(opts?.italic ? { italic: true } : {}),
        ...(opts?.subcategory ? { subcategory: opts.subcategory } : {}),
    }
}

// ── Theme Definitions ────────────────────────────────────────────────────────
// Grouped: Light → Dark Neutral → Dark Warm → Dark Cool → Dark Vibrant → Community

export const THEME_OPTIONS: ThemeOption[] = [

    // ── Light ────────────────────────────────────────────────────────────────

    theme('light', 'Light', 'Bright and clean interface', '☀️', 'standard', {
        background: '0 0% 100%', card: '0 0% 98%', cardForeground: '222 84% 5%',
        primary: '221 83% 53%', muted: '220 14% 95%', mutedForeground: '220 9% 46%',
        destructive: '0 84% 60%', border: '220 13% 70%',
    }, { subcategory: 'light' }),
    theme('hoth', 'Hoth', 'Frosted whites with glacial accents', '❄️', 'standard', {
        background: '210 40% 98%', card: '0 0% 100%', cardForeground: '222 84% 5%',
        primary: '199 89% 37%', muted: '210 40% 95%', mutedForeground: '215 16% 38%',
        destructive: '0 84% 60%', border: '214 32% 68%',
    }, { subcategory: 'light' }),
    theme('parchment', 'Parchment', 'Warm sepia cream with amber highlights, the missing warm light theme', '📜', 'standard', {
        background: '36 35% 87%', card: '36 40% 97%', cardForeground: '20 40% 15%',
        primary: '25 70% 35%', muted: '36 25% 90%', mutedForeground: '20 20% 38%',
        destructive: '0 72% 45%', border: '36 22% 60%',
    }, { subcategory: 'light' }),
    theme('vellum', 'Vellum', 'Cooler grey-cream with deep blue ink, quality paper aesthetic', '🗒️', 'standard', {
        background: '45 20% 90%', card: '45 15% 98%', cardForeground: '220 25% 16%',
        primary: '215 60% 45%', muted: '45 12% 92%', mutedForeground: '220 12% 24%',
        destructive: '0 72% 45%', border: '45 15% 72%',
    }, { subcategory: 'light' }),
    theme('sepia', 'Sepia', 'Deep amber sepia, like an old photograph faded with warmth', '📷', 'standard', {
        background: '25 45% 82%', card: '25 40% 92%', cardForeground: '20 50% 10%',
        primary: '20 80% 28%', muted: '25 30% 86%', mutedForeground: '20 25% 24%',
        destructive: '0 72% 45%', border: '25 30% 62%',
    }, { subcategory: 'light' }),
    theme('manuscript', 'Manuscript', 'Neutral parchment with crimson ink, illuminated manuscript vibes', '✍️', 'standard', {
        background: '50 15% 88%', card: '50 10% 96%', cardForeground: '230 30% 15%',
        primary: '355 60% 38%', muted: '50 12% 91%', mutedForeground: '230 15% 25%',
        destructive: '0 72% 45%', border: '50 12% 70%',
    }, { subcategory: 'light' }),
    theme('linen', 'Linen', 'Warm off-white linen with dusty rose accent, soft and tactile', '🧵', 'standard', {
        background: '25 30% 91%', card: '25 20% 98%', cardForeground: '340 20% 15%',
        primary: '340 45% 42%', muted: '25 18% 93%', mutedForeground: '340 12% 25%',
        destructive: '0 72% 45%', border: '25 18% 74%',
    }, { subcategory: 'light' }),
    theme('driftwood', 'Driftwood', 'Bleached wood tones on warm sand, like a beach house interior', '🪵', 'standard', {
        background: '36 30% 88%', card: '36 20% 97%', cardForeground: '25 30% 15%',
        primary: '25 55% 38%', muted: '36 18% 91%', mutedForeground: '25 18% 25%',
        destructive: '0 72% 45%', border: '36 18% 68%',
    }, { subcategory: 'light' }),
    theme('catppuccin-latte', 'Catppuccin Latte', 'Our lightest theme harmoniously inverting the essence of Catppuccin', '☕', 'standard', {
        background: '220 23% 90%', card: '0 0% 100%', cardForeground: '234 16% 28%',
        primary: '266 85% 58%', muted: '220 23% 93%', mutedForeground: '231 10% 42%',
        destructive: '351 74% 57%', border: '231 10% 78%',
    }, { subcategory: 'light' }),

    // ── Dark Neutral ─────────────────────────────────────────────────────────

    theme('nightfall', 'Nightfall', 'Balanced contrast for low-light focus', '🌙', 'standard', {
        background: '222 47% 11%', card: '217 33% 21%', cardForeground: '210 40% 98%',
        primary: '217 91% 60%', muted: '217 33% 15%', mutedForeground: '215 20% 65%',
        destructive: '0 63% 31%', border: '217 33% 28%', ring: '224 76% 48%',
    }, { subcategory: 'dark' }),
    theme('dark', 'Midnight', 'High-contrast OLED black', '🌑', 'standard', {
        background: '0 0% 0%', card: '0 0% 6%', cardForeground: '0 0% 98%',
        primary: '211 100% 50%', primaryForeground: '0 0% 100%',
        muted: '0 0% 2%', mutedForeground: '0 0% 64%',
        destructive: '0 63% 31%', border: '0 0% 14%', ring: '211 100% 50%',
    }, { subcategory: 'oled' }),
    theme('slate-mono', 'Slate Mono', 'Pure monochrome, zero hue, maximum focus, zero distraction', '🪨', 'standard', {
        background: '0 0% 9%', card: '0 0% 20%', cardForeground: '0 0% 98%',
        primary: '0 0% 88%', muted: '0 0% 10%', mutedForeground: '0 0% 50%',
        destructive: '0 65% 50%', border: '0 0% 22%', ring: '0 0% 98%',
    }, { subcategory: 'oled' }),
    theme('high-contrast', 'High Contrast', 'WCAG AAA compliant, pure black with electric lime for maximum legibility', '♿', 'standard', {
        background: '0 0% 0%', card: '0 0% 6%', cardForeground: '0 0% 100%',
        primary: '151 100% 50%', muted: '0 0% 2%', mutedForeground: '0 0% 70%',
        destructive: '0 100% 60%', border: '0 0% 14%',
    }, { subcategory: 'oled' }),
    theme('github-dark-dimmed', 'GitHub Dark Dimmed', 'Softer contrast for less eye strain', '🐙', 'standard', {
        background: '215 15% 16%', card: '215 18% 23%', cardForeground: '210 17% 73%',
        primary: '213 90% 64%', muted: '215 18% 19%', mutedForeground: '210 10% 55%',
        destructive: '3 75% 60%', border: '215 18% 30%',
    }, { subcategory: 'dark' }),
    theme('one-dark-pro', 'One Dark Pro', 'Iconic Atom One Dark vibes', '⚛️', 'standard', {
        background: '220 13% 18%', card: '220 13% 25%', cardForeground: '219 14% 71%',
        primary: '207 82% 66%', muted: '216 13% 21%', mutedForeground: '219 10% 56%',
        destructive: '355 65% 65%', border: '216 13% 32%',
    }, { subcategory: 'dark' }),
    theme('gruvbox-dark', 'Gruvbox Dark', 'Retro groove color scheme', '📻', 'standard', {
        background: '0 0% 16%', card: '20 5% 23%', cardForeground: '43 47% 81%',
        primary: '27 99% 55%', muted: '20 5% 19%', mutedForeground: '34 22% 59%',
        destructive: '1 73% 46%', border: '20 5% 30%',
    }, { subcategory: 'dark' }),
    theme('monokai-pro', 'Monokai Pro', 'Beautiful functionality for pro dev', '🍌', 'standard', {
        background: '300 4% 17%', card: '300 4% 24%', cardForeground: '60 40% 98%',
        primary: '45 100% 70%', muted: '300 4% 20%', mutedForeground: '300 2% 56%',
        destructive: '345 100% 69%', border: '300 4% 31%',
    }, { subcategory: 'dark' }),
    theme('nord', 'Nord', 'Arctic, north-bluish color palette', '🏔️', 'standard', {
        background: '220 16% 22%', card: '220 17% 29%', cardForeground: '219 28% 88%',
        primary: '193 43% 67%', muted: '220 17% 25%', mutedForeground: '92 28% 65%',
        destructive: '354 42% 56%', border: '220 16% 36%',
    }, { subcategory: 'dark' }),

    // ── Dark Cool / Blue ─────────────────────────────────────────────────────

    theme('ochin', 'Ochin', 'Ocean blues with soft highlights', '🌊', 'standard', {
        background: '213 53% 10%', card: '213 40% 19%', cardForeground: '210 40% 98%',
        primary: '198 93% 60%', muted: '213 35% 12%', mutedForeground: '199 92% 75%',
        destructive: '0 63% 31%', border: '213 35% 24%',
    }, { subcategory: 'dark' }),
    theme('night-owl', 'Night Owl', 'Fine-tuned for late night coding', '🦉', 'standard', {
        background: '207 95% 8%', card: '207 92% 17%', cardForeground: '217 40% 88%',
        primary: '221 100% 75%', muted: '207 92% 10%', mutedForeground: '207 23% 48%',
        destructive: '3 86% 63%', border: '206 60% 21%',
    }, { subcategory: 'dark' }),
    theme('cobalt2', 'Cobalt2', 'Blue-yellow high contrast theme by Wes Bos', '🔥', 'standard', {
        background: '205 49% 19%', card: '207 51% 27%', cardForeground: '0 0% 93%',
        primary: '47 100% 50%', muted: '207 51% 22%', mutedForeground: '206 11% 58%',
        destructive: '344 100% 69%', border: '207 51% 35%',
    }, { subcategory: 'dark' }),
    theme('solarized-dark', 'Solarized Dark', 'Precision colors for machines and people', '🌤️', 'standard', {
        background: '192 100% 11%', card: '192 81% 18%', cardForeground: '186 9% 65%',
        primary: '205 69% 54%', muted: '192 81% 14%', mutedForeground: '194 14% 53%',
        destructive: '1 71% 52%', border: '192 81% 30%',
    }, { subcategory: 'dark' }),
    theme('mermaid', 'Mermaid', 'Iridescent deep sea, midnight teal with shimmering aqua', '🧜', 'standard', {
        background: '205 50% 11%', card: '205 44% 21%', cardForeground: '190 65% 94%',
        primary: '182 72% 67%', muted: '205 35% 15%', mutedForeground: '200 25% 56%',
        destructive: '0 60% 45%', border: '205 35% 28%',
    }, { subcategory: 'dark' }),
    theme('infrared', 'Infrared', 'Deep dark teal with hot coral accent, data terminal aesthetic', '📡', 'standard', {
        background: '192 60% 7%', card: '192 50% 17%', cardForeground: '180 40% 92%',
        primary: '4 85% 65%', muted: '192 40% 11%', mutedForeground: '185 25% 56%',
        destructive: '0 65% 45%', border: '192 40% 24%',
    }, { subcategory: 'dark' }),
    theme('ayu-mirage', 'Ayu Mirage', 'Simple, bright and elegant theme', '🌅', 'standard', {
        background: '223 22% 16%', card: '222 22% 24%', cardForeground: '60 4% 79%',
        primary: '40 100% 70%', muted: '222 22% 19%', mutedForeground: '219 11% 53%',
        destructive: '7 81% 71%', border: '222 22% 30%',
    }, { subcategory: 'dark' }),

    // ── Dark Vibrant / Purple / Pink ─────────────────────────────────────────

    theme('aurora', 'Aurora', 'Violet twilight with neon glow', '🌌', 'standard', {
        background: '229 35% 12%', card: '228 24% 23%', cardForeground: '240 100% 98%',
        primary: '271 91% 65%', muted: '228 22% 16%', mutedForeground: '229 84% 81%',
        destructive: '347 77% 50%', border: '228 20% 31%',
    }, { subcategory: 'dark' }),
    theme('aubergine', 'Aubergine', 'Rich purples with vibrant highlights', '🍆', 'standard', {
        background: '277 43% 11%', card: '277 30% 23%', cardForeground: '270 100% 98%',
        primary: '277 70% 63%', muted: '277 26% 16%', mutedForeground: '277 53% 86%',
        destructive: '347 77% 50%', border: '277 23% 34%',
    }, { subcategory: 'dark' }),
    theme('dracula', 'Dracula', 'The classic developer theme', '🧛', 'standard', {
        background: '231 15% 18%', card: '232 14% 27%', cardForeground: '60 30% 96%',
        primary: '265 89% 78%', muted: '232 14% 22%', mutedForeground: '225 27% 62%',
        destructive: '0 100% 67%', border: '232 14% 35%',
    }, { subcategory: 'dark' }),
    theme('synthwave', 'Synthwave', '80s retro vibes with neon gradients', '🎮', 'standard', {
        background: '277 30% 11%', card: '277 26% 23%', cardForeground: '300 100% 100%',
        primary: '324 100% 70%', muted: '277 24% 16%', mutedForeground: '200 100% 79%',
        destructive: '347 100% 61%', border: '277 22% 29%',
    }, { subcategory: 'dark' }),
    theme('synthwave-84', "SynthWave '84", 'Vibrant neon 80s aesthetics outrun theme', '📼', 'standard', {
        background: '250 21% 17%', card: '249 19% 26%', cardForeground: '264 56% 96%',
        primary: '317 100% 75%', muted: '249 19% 21%', mutedForeground: '233 26% 63%',
        destructive: '356 99% 63%', border: '249 19% 33%',
    }, { subcategory: 'dark' }),
    theme('catppuccin-frappe', 'Catppuccin Frappé', 'A less vibrant alternative using subdued colors for a muted aesthetic', '☕', 'standard', {
        background: '229 19% 23%', card: '229 19% 30%', cardForeground: '227 70% 87%',
        primary: '277 59% 76%', muted: '229 19% 27%', mutedForeground: '229 14% 65%',
        destructive: '354 75% 67%', border: '229 14% 52%',
    }, { subcategory: 'dark' }),
    theme('catppuccin-macchiato', 'Catppuccin Macchiato', 'Medium contrast with gentle colors creating a soothing atmosphere', '☕', 'standard', {
        background: '232 23% 18%', card: '232 23% 26%', cardForeground: '227 70% 88%',
        primary: '267 83% 80%', muted: '232 23% 22%', mutedForeground: '231 16% 57%',
        destructive: '353 74% 67%', border: '231 16% 57%',
    }, { subcategory: 'dark' }),
    theme('catppuccin-mocha', 'Catppuccin Mocha', 'Soothing pastel theme for the high-spirited', '☕', 'standard', {
        background: '240 21% 15%', card: '240 21% 26%', cardForeground: '226 64% 88%',
        primary: '267 84% 81%', muted: '240 21% 19%', mutedForeground: '231 11% 55%',
        destructive: '343 81% 75%', border: '231 11% 47%',
    }, { subcategory: 'dark' }),
    theme('tokyo-night', 'Tokyo Night', 'A clean, dark theme that celebrates the lights of downtown Tokyo at night', '🗼', 'standard', {
        background: '235 19% 13%', card: '235 19% 23%', cardForeground: '229 59% 85%',
        primary: '226 90% 72%', muted: '240 15% 17%', mutedForeground: '229 23% 56%',
        destructive: '349 89% 72%', border: '228 23% 32%',
    }, { subcategory: 'dark' }),
    theme('rose-pine', 'Rosé Pine', 'All natural pine, faux fur and a bit of soho vibes', '🌹', 'standard', {
        background: '249 22% 12%', card: '247 23% 24%', cardForeground: '245 42% 91%',
        primary: '2 46% 82%', muted: '247 23% 17%', mutedForeground: '248 15% 61%',
        destructive: '343 76% 68%', border: '247 23% 33%',
    }, { subcategory: 'dark' }),
    theme('material-palenight', 'Material Palenight', 'Elegant and juicy Material Design theme', '🎨', 'standard', {
        background: '228 20% 20%', card: '229 23% 29%', cardForeground: '231 28% 73%',
        primary: '276 68% 74%', muted: '229 23% 24%', mutedForeground: '231 18% 60%',
        destructive: '357 80% 69%', border: '229 23% 35%',
    }, { subcategory: 'dark' }),
    theme('deep-space', 'Deep Space', 'Near-black indigo with electric violet, deeper and more cosmic than Aurora', '🪐', 'standard', {
        background: '244 55% 6%', card: '244 45% 25%', cardForeground: '250 60% 95%',
        primary: '262 80% 62%', muted: '244 38% 8%', mutedForeground: '248 22% 56%',
        destructive: '0 65% 45%', border: '244 38% 22%',
    }, { subcategory: 'dark' }),

    // ── Dark Warm ────────────────────────────────────────────────────────────

    theme('cafe', 'Café', 'Warm coffee tones for focus', '☕', 'standard', {
        background: '24 20% 9%', card: '24 16% 19%', cardForeground: '44 87% 94%',
        primary: '45 93% 47%', muted: '24 14% 13%', mutedForeground: '48 96% 72%',
        destructive: '0 63% 31%', border: '24 13% 27%',
    }, { subcategory: 'dark' }),
    theme('sunset', 'Sunset', 'Warm oranges and golden hour vibes', '🌅', 'standard', {
        background: '20 25% 8%', card: '20 20% 19%', cardForeground: '33 100% 96%',
        primary: '27 96% 61%', muted: '20 17% 12%', mutedForeground: '27 97% 72%',
        destructive: '0 63% 31%', border: '20 15% 27%',
    }, { subcategory: 'dark' }),
    theme('amber-glass', 'Amber Glass', 'Honey and amber on deep brown, warm golden hour nostalgic', '🍯', 'standard', {
        background: '32 75% 6%', card: '32 65% 17%', cardForeground: '42 80% 88%',
        primary: '38 88% 51%', muted: '32 55% 10%', mutedForeground: '35 40% 52%',
        destructive: '0 65% 45%', border: '32 50% 24%',
    }, { subcategory: 'dark' }),
    theme('ember', 'Ember', 'Deep burnt charcoal with glowing ember orange', '🔥', 'standard', {
        background: '25 65% 7%', card: '25 55% 17%', cardForeground: '36 75% 88%',
        primary: '22 92% 48%', muted: '25 45% 11%', mutedForeground: '30 35% 55%',
        destructive: '0 65% 45%', border: '25 45% 25%',
    }, { subcategory: 'dark' }),
    theme('parchment-dusk', 'Parchment Dusk', 'Late afternoon warmth, medium tone between light and dark', '🌇', 'standard', {
        background: '30 25% 72%', card: '30 20% 82%', cardForeground: '20 35% 12%',
        primary: '25 65% 30%', muted: '30 18% 76%', mutedForeground: '20 18% 20%',
        destructive: '0 72% 45%', border: '30 18% 55%',
    }, { subcategory: 'light' }),
    theme('parchment-dark', 'Parchment Dark', 'Aged paper at night, rich warm brown with glowing amber accent', '🕯️', 'standard', {
        background: '25 30% 14%', card: '25 25% 22%', cardForeground: '36 40% 88%',
        primary: '30 75% 55%', muted: '25 22% 17%', mutedForeground: '30 20% 57%',
        destructive: '0 65% 45%', border: '25 22% 34%',
    }, { subcategory: 'dark' }),
    theme('obsidian-gold', 'Obsidian Gold', 'Pure black with warm 24k gold accents, luxury contrast', '✦', 'standard', {
        background: '0 0% 4%', card: '0 0% 17%', cardForeground: '36 50% 93%',
        primary: '38 65% 55%', muted: '0 0% 6%', mutedForeground: '35 12% 53%',
        destructive: '0 65% 45%', border: '0 0% 18%',
    }, { subcategory: 'oled' }),

    // ── Dark Green ───────────────────────────────────────────────────────────

    theme('choco-mint', 'Choco Mint', 'Earthy neutrals with mint highlights', '🍫', 'standard', {
        background: '120 10% 11%', card: '120 10% 20%', cardForeground: '120 60% 97%',
        primary: '142 71% 38%', muted: '120 10% 15%', mutedForeground: '142 77% 73%',
        destructive: '0 63% 31%', border: '120 10% 27%',
    }, { subcategory: 'dark' }),
    theme('everforest', 'Everforest', 'Deep emerald forest with warm stone accents', '🌲', 'standard', {
        background: '210 12% 18%', card: '210 10% 26%', cardForeground: '42 30% 83%',
        primary: '95 33% 63%', muted: '210 10% 21%', mutedForeground: '150 8% 55%',
        destructive: '0 55% 55%', border: '210 10% 33%',
    }, { subcategory: 'dark' }),
    theme('clinical-mint', 'Clinical Mint', 'Medical-grade dusty mint on deep slate, clean and restorative', '🌿', 'standard', {
        background: '168 22% 9%', card: '168 18% 19%', cardForeground: '160 40% 91%',
        primary: '165 48% 66%', muted: '168 15% 13%', mutedForeground: '165 18% 55%',
        destructive: '0 60% 45%', border: '168 15% 26%',
    }, { subcategory: 'dark' }),

    // ── Dark Red / Pink ──────────────────────────────────────────────────────

    theme('kanagawa', 'Kanagawa', 'Deep ink blues with warm lotus red, calm, focused, dramatic', '🏯', 'standard', {
        background: '240 14% 14%', card: '240 12% 24%', cardForeground: '47 45% 86%',
        primary: '351 62% 66%', muted: '240 12% 18%', mutedForeground: '240 6% 54%',
        destructive: '0 55% 50%', border: '240 12% 32%',
    }, { subcategory: 'dark' }),
    theme('rose-gold', 'Rose Gold', 'Soft pinks and elegant golds', '🌸', 'standard', {
        background: '340 15% 9%', card: '340 13% 20%', cardForeground: '327 73% 97%',
        primary: '330 81% 55%', muted: '340 12% 13%', mutedForeground: '330 90% 82%',
        destructive: '0 63% 31%', border: '340 11% 29%',
    }, { subcategory: 'dark' }),
    theme('cyberpunk', 'Cyberpunk', 'Neon pink and cyan on dark', '🤖', 'standard', {
        background: '240 33% 4%', card: '240 20% 20%', cardForeground: '300 100% 98%',
        primary: '292 91% 83%', muted: '240 17% 6%', mutedForeground: '187 92% 69%',
        destructive: '338 100% 50%', border: '240 15% 18%', ring: '180 100% 50%',
    }, { subcategory: 'dark' }),
    theme('crimson', 'Crimson', 'Deep oxblood red with rose highlights, dark luxury red', '🍷', 'standard', {
        background: '348 50% 8%', card: '348 42% 20%', cardForeground: '10 50% 96%',
        primary: '4 58% 52%', muted: '348 35% 10%', mutedForeground: '348 20% 58%',
        destructive: '0 72% 45%', border: '348 35% 22%',
    }, { subcategory: 'dark' }),

    // ── Community ────────────────────────────────────────────────────────────

    theme('stremio', 'Stremio', 'Authorized community purple', '🟣', 'community', {
        background: '258 46% 12%', card: '258 43% 25%', cardForeground: '258 30% 98%',
        primary: '262 53% 62%', muted: '258 35% 17%', mutedForeground: '258 40% 75%',
        destructive: '0 63% 31%', border: '258 30% 30%',
    }),
    theme('torbox', 'TorBox', 'Digital green cloud', '📦', 'community', {
        background: '185 30% 6%', card: '185 25% 17%', cardForeground: '160 30% 98%',
        primary: '161 56% 40%', muted: '185 20% 10%', mutedForeground: '160 20% 70%',
        destructive: '0 60% 40%', border: '185 20% 24%',
    }),
    theme('real-debrid', 'Real-Debrid', 'Sky blue connect', '🍋', 'community', {
        background: '205 30% 10%', card: '205 25% 19%', cardForeground: '200 30% 98%',
        primary: '202 70% 78%', muted: '205 20% 14%', mutedForeground: '205 15% 70%',
        destructive: '0 63% 31%', border: '205 20% 29%',
    }),
    theme('alldebrid', 'AllDebrid', 'Amber energy flow', '🟠', 'community', {
        background: '36 30% 8%', card: '36 25% 18%', cardForeground: '36 30% 98%',
        primary: '36 89% 40%', muted: '36 20% 12%', mutedForeground: '36 20% 70%',
        destructive: '0 60% 40%', border: '36 20% 25%',
    }),
    theme('premiumize', 'Premiumize', 'Deep ocean link', '🌊', 'community', {
        background: '208 40% 10%', card: '208 35% 20%', cardForeground: '208 10% 98%',
        primary: '48 100% 50%', muted: '208 25% 14%', mutedForeground: '208 20% 70%',
        destructive: '0 60% 40%', border: '208 25% 28%',
    }),
    theme('aiostreams', 'AIOStreams', 'Pure Monochrome', '📡', 'community', {
        background: '0 0% 5%', card: '0 0% 16%', cardForeground: '0 0% 98%',
        primary: '0 0% 100%', muted: '0 0% 7%', mutedForeground: '0 0% 60%',
        destructive: '0 60% 40%', border: '0 0% 20%',
    }),
    theme('comet', 'Comet', 'Cosmic speed teal', '☄️', 'community', {
        background: '220 30% 6%', card: '220 25% 18%', cardForeground: '220 15% 98%',
        primary: '165 80% 60%', muted: '220 20% 8%', mutedForeground: '220 20% 60%',
        destructive: '0 60% 40%', border: '220 20% 21%', ring: '210 100% 64%',
    }),
    theme('elfhosted', 'ElfHosted', 'Open source stream hosting', '🧝', 'community', {
        background: '96 40% 10%', card: '96 35% 18%', cardForeground: '96 30% 98%',
        primary: '96 58% 38%', muted: '96 25% 13%', mutedForeground: '96 20% 70%',
        destructive: '0 60% 40%', border: '96 25% 29%',
    }),
    theme('trakt', 'Trakt', 'Scrobbler Red', '✔', 'community', {
        background: '0 0% 8%', card: '0 0% 19%', cardForeground: '0 0% 98%',
        primary: '355 85% 55%', muted: '0 0% 12%', mutedForeground: '0 0% 70%',
        destructive: '0 63% 31%', border: '0 0% 26%',
    }),
    theme('simkl', 'Simkl', 'Tracker deep blue', '🟦', 'community', {
        background: '0 0% 6%', card: '0 0% 18%', cardForeground: '225 30% 98%',
        primary: '220 80% 60%', muted: '0 0% 11%', mutedForeground: '225 15% 70%',
        destructive: '0 60% 40%', border: '0 0% 25%',
    }),
    theme('sonic', 'Sonicx161', 'The theme I used to develop 2.0', '⚡', 'community', {
        background: '30 25% 96%', card: '30 11% 100%', cardForeground: '30 11% 5%',
        primary: '30 70% 45%', muted: '30 14% 93%', mutedForeground: '30 11% 60%',
        destructive: '0 63% 40%', border: '30 14% 85%', ring: '30 70% 45%',
    }, { italic: true }),
]

// ── Custom Theme Generator ───────────────────────────────────────────────────

/** Build a full palette from a single accent hue + base mode. */
export function generatePaletteFromAccent(
    hue: number,
    saturation: number,
    base: 'dark' | 'light' | 'oled',
    overrides?: Partial<CompactPalette>,
): CompactPalette {
    const h = Math.round(hue % 360)
    const s = Math.round(Math.max(0, Math.min(100, saturation)))

    if (base === 'oled') {
        return {
            background: `${h} 0% 0%`,
            card: `${h} ${Math.round(s * 0.15)}% 8%`,
            cardForeground: `${h} ${Math.round(s * 0.15)}% 98%`,
            primary: `${h} ${s}% 60%`,
            muted: `${h} ${Math.round(s * 0.1)}% 6%`,
            mutedForeground: `${h} ${Math.round(s * 0.15)}% 50%`,
            destructive: '0 63% 40%',
            border: `${h} ${Math.round(s * 0.15)}% 14%`,
            ...overrides,
        }
    }

    if (base === 'dark') {
        return {
            background: `${h} ${Math.round(s * 0.35)}% 9%`,
            card: `${h} ${Math.round(s * 0.25)}% 16%`,
            cardForeground: `${h} ${Math.round(s * 0.15)}% 98%`,
            primary: `${h} ${s}% 60%`,
            muted: `${h} ${Math.round(s * 0.2)}% 12%`,
            mutedForeground: `${h} ${Math.round(s * 0.15)}% 55%`,
            destructive: '0 63% 40%',
            border: `${h} ${Math.round(s * 0.2)}% 22%`,
            ...overrides,
        }
    } else {
        return {
            background: `${h} ${Math.round(s * 0.25)}% 96%`,
            card: `${h} ${Math.round(s * 0.15)}% 100%`,
            cardForeground: `${h} ${Math.round(s * 0.2)}% 15%`,
            primary: `${h} ${s}% 45%`,
            muted: `${h} ${Math.round(s * 0.15)}% 93%`,
            mutedForeground: `${h} ${Math.round(s * 0.1)}% 40%`,
            destructive: '0 63% 40%',
            border: `${h} ${Math.round(s * 0.15)}% 85%`,
            ...overrides,
        }
    }
}
