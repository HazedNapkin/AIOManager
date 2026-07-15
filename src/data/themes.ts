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
    | 'cyberpunk-2077'
    | 'downtown'
    | 'cream-coffee'
    | 'city-sunset'
    | 'dusty-sage'
    | 'faded-rose'
    | 'black-ops'
    | 'oled-green'
    | 'oled-red'
    | 'oled-cyan'
    | 'oled-purple'
    | 'modern-warfare'
    | 'eclipse'
    | 'fusion'
    | 'nuvio'
    | 'realstream'
    | 'light-retro'
    | 'light-mint'
    | 'light-sky'
    | 'light-rose'
    | 'kawaii'
    | 'pastel-peach'
    | 'dusk'
    | 'twilight'
    | 'coral-reef'
    | 'bubblegum'
    | 'citrus'
    | 'sakura'
    | 'tropical'
    | 'spring-meadow'
    | 'lagoon'
    | 'cotton-candy'
    | 'golden-hour'
    | 'terracotta'
    | 'seafoam-light'
    | 'lavender-fields'
    | 'minecraft'
    | 'nvidia'
    | 'amd'
    | 'steam'
    | 'ocean-mist'
    | 'forest-canopy'
    | 'desert-dune'
    | 'berry-blush'
    | 'rose-quartz'
    | 'golden-wheat'
    | 'mint-meadow'
    | 'peach-blossom'
    | 'pokemon'
    | 'pikachu'
    | 'bulbasaur'
    | 'charmander'
    | 'squirtle'
    | 'oled-pink'
    | 'oled-orange'
    | 'oled-yellow'
    | 'emerald'
    | 'sapphire'
    | 'ruby'
    | 'amethyst'
    | 'comic-book'
    | 'stained-glass'
    | 'lime-zest'
    | 'tangerine'
    | 'turquoise'
    | 'electric-violet'
    | 'hot-coral'
    | 'volcano'
    | 'aurora-borealis'
    | 'toxic-waste'
    | 'indigo-light'
    | 'periwinkle'
    | 'cornflower'
    | 'oled-teal'
    | 'oled-magenta'
    | 'oled-indigo'
    | 'oled-lime'
    | 'pastel-dream'
    | 'neon-dream'
    | 'watermelon'
    | 'candy'
    | 'gamer'
    | 'royal'
    | 'poison-apple'
    | 'tropical-punch'
    | 'ice-cream'
    | 'midnight-carnival'
    | 'dragon-fruit'
    | 'tamtaro'
    | `custom-${string}`

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
    customCss?: string
    logoUrl?: string
}

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
    opts?: { italic?: boolean; subcategory?: 'light' | 'dark' | 'oled'; customCss?: string; logoUrl?: string },
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
        ...(opts?.customCss ? { customCss: opts.customCss } : {}),
        ...(opts?.logoUrl ? { logoUrl: opts.logoUrl } : {}),
    }
}

export const THEME_OPTIONS: ThemeOption[] = [

    theme('coral-reef', 'Coral Reef', 'Tropical underwater warmth with coral and turquoise sea life', '🪸', 'standard', {
        background: '10 40% 92%', card: '180 30% 98%', cardForeground: '10 35% 15%',
        primary: '8 65% 50%', primaryForeground: '0 0% 100%',
        muted: '180 20% 90%', mutedForeground: '180 15% 35%',
        destructive: '0 72% 45%', border: '10 18% 78%', ring: '180 50% 45%',
    }, { subcategory: 'light' }),
    theme('peach-blossom', 'Peach Blossom', 'Warm peach and coral with lighter blush cards, spring orchard in bloom', '🍑', 'standard', {
        background: '20 28% 78%', card: '20 35% 88%', cardForeground: '15 32% 14%',
        primary: '12 55% 42%', primaryForeground: '0 0% 100%',
        muted: '20 18% 72%', mutedForeground: '15 20% 30%',
        destructive: '0 72% 45%', border: '20 20% 66%',
    }, { subcategory: 'light' }),
    theme('terracotta', 'Terracotta', 'Mediterranean clay and olive, warm earthy sun-baked tones', '🏺', 'standard', {
        background: '20 35% 90%', card: '30 25% 97%', cardForeground: '20 35% 14%',
        primary: '18 60% 45%', primaryForeground: '0 0% 100%',
        muted: '80 15% 88%', mutedForeground: '80 15% 30%',
        destructive: '0 72% 45%', border: '20 18% 75%', ring: '80 30% 40%',
    }, { subcategory: 'light' }),
    theme('sepia', 'Sepia', 'Deep amber sepia, like an old photograph faded with warmth', '📷', 'standard', {
        background: '25 45% 82%', card: '25 40% 92%', cardForeground: '20 50% 10%',
        primary: '20 80% 28%', muted: '25 30% 86%', mutedForeground: '20 25% 24%',
        destructive: '0 72% 45%', border: '25 30% 62%',
    }, { subcategory: 'light' }),
    theme('pastel-peach', 'Pastel Peach', 'Soft warm peach and coral pastel, gentle Mediterranean warmth', '🍑', 'standard', {
        background: '25 50% 92%', card: '25 40% 99%', cardForeground: '20 30% 18%',
        primary: '20 60% 55%', primaryForeground: '0 0% 100%',
        muted: '25 35% 89%', mutedForeground: '20 20% 38%',
        destructive: '0 72% 45%', border: '25 25% 78%',
    }, { subcategory: 'light' }),
    theme('tangerine', 'Tangerine', 'Bright mandarin orange, zesty and full of energy', '🍊', 'standard', {
        background: '28 55% 90%', card: '28 40% 96%', cardForeground: '25 50% 14%',
        primary: '22 85% 50%', primaryForeground: '0 0% 100%',
        muted: '28 28% 84%', mutedForeground: '25 28% 33%',
        destructive: '0 80% 50%', border: '28 22% 74%', ring: '45 80% 50%',
    }, { subcategory: 'light' }),
    theme('parchment', 'Parchment', 'Warm sepia cream with amber highlights, the missing warm light theme', '📜', 'standard', {
        background: '36 35% 87%', card: '36 40% 97%', cardForeground: '20 40% 15%',
        primary: '25 70% 35%', muted: '36 25% 90%', mutedForeground: '20 20% 38%',
        destructive: '0 72% 45%', border: '36 22% 60%',
    }, { subcategory: 'light' }),
    theme('driftwood', 'Driftwood', 'Bleached wood tones on warm sand, like a beach house interior', '🪵', 'standard', {
        background: '36 30% 88%', card: '36 20% 97%', cardForeground: '25 30% 15%',
        primary: '25 55% 38%', muted: '36 18% 91%', mutedForeground: '25 18% 25%',
        destructive: '0 72% 45%', border: '36 18% 68%',
    }, { subcategory: 'light' }),
    theme('parchment-dusk', 'Parchment Dusk', 'Late afternoon warmth, medium tone between light and dark', '🌇', 'standard', {
        background: '30 25% 72%', card: '30 20% 82%', cardForeground: '20 35% 12%',
        primary: '25 65% 30%', muted: '30 18% 76%', mutedForeground: '20 18% 20%',
        destructive: '0 72% 45%', border: '30 18% 55%',
    }, { subcategory: 'light' }),
    theme('desert-dune', 'Desert Dune', 'Warm sandy desert with lighter sand cards, sun-baked earth', '🏜️', 'standard', {
        background: '35 30% 76%', card: '35 35% 86%', cardForeground: '30 35% 14%',
        primary: '25 55% 38%', primaryForeground: '0 0% 100%',
        muted: '35 20% 70%', mutedForeground: '30 22% 30%',
        destructive: '0 72% 45%', border: '35 22% 64%',
    }, { subcategory: 'light' }),
    theme('tropical', 'Tropical', 'Warm sunset paradise with vibrant mango and palm accents', '🌴', 'standard', {
        background: '30 40% 92%', card: '35 28% 98%', cardForeground: '25 35% 14%',
        primary: '28 75% 48%', primaryForeground: '0 0% 100%',
        muted: '30 22% 89%', mutedForeground: '25 22% 33%',
        destructive: '0 72% 45%', border: '30 18% 78%', ring: '150 40% 40%',
    }, { subcategory: 'light' }),
    theme('golden-wheat', 'Golden Wheat', 'Golden harvest fields with lighter grain cards, autumn abundance', '🌾', 'standard', {
        background: '42 35% 76%', card: '42 40% 86%', cardForeground: '35 35% 14%',
        primary: '35 60% 38%', primaryForeground: '0 0% 100%',
        muted: '42 22% 70%', mutedForeground: '35 22% 30%',
        destructive: '0 72% 45%', border: '42 22% 64%',
    }, { subcategory: 'light' }),
    theme('golden-hour', 'Golden Hour', 'Warm amber honey glow, the perfect hour before sunset', '🌅', 'standard', {
        background: '38 40% 92%', card: '40 28% 98%', cardForeground: '30 35% 14%',
        primary: '36 70% 45%', primaryForeground: '0 0% 100%',
        muted: '38 25% 89%', mutedForeground: '30 22% 33%',
        destructive: '0 72% 45%', border: '38 20% 78%',
    }, { subcategory: 'light' }),
    theme('citrus', 'Citrus', 'Zesty lemon and lime, bright and refreshing', '🍋', 'standard', {
        background: '55 40% 92%', card: '55 28% 98%', cardForeground: '55 35% 14%',
        primary: '50 75% 42%', primaryForeground: '0 0% 100%',
        muted: '80 25% 89%', mutedForeground: '55 22% 32%',
        destructive: '0 72% 45%', border: '55 20% 78%', ring: '90 50% 40%',
    }, { subcategory: 'light' }),
    theme('lime-zest', 'Lime Zest', 'Electric lime green, sour and shocking like a fresh citrus burst', '💚', 'standard', {
        background: '80 50% 90%', card: '80 35% 96%', cardForeground: '80 45% 14%',
        primary: '78 80% 42%', primaryForeground: '0 0% 100%',
        muted: '80 25% 84%', mutedForeground: '80 25% 30%',
        destructive: '0 80% 50%', border: '80 20% 74%', ring: '120 60% 40%',
    }, { subcategory: 'light' }),
    theme('rose-pine', 'Rosé Pine', 'All natural pine, faux fur and a bit of soho vibes', '🌹', 'standard', {
        background: '249 22% 12%', card: '247 23% 24%', cardForeground: '245 42% 91%',
        primary: '2 46% 82%', muted: '247 23% 17%', mutedForeground: '248 15% 61%',
        destructive: '343 76% 68%', border: '247 23% 33%',
    }, { subcategory: 'dark' }),
    theme('infrared', 'Infrared', 'Deep dark teal with hot coral accent, data terminal aesthetic', '📡', 'standard', {
        background: '192 60% 7%', card: '192 50% 17%', cardForeground: '180 40% 92%',
        primary: '4 85% 65%', muted: '192 40% 11%', mutedForeground: '185 25% 56%',
        destructive: '0 65% 45%', border: '192 40% 24%',
    }, { subcategory: 'dark' }),
    theme('crimson', 'Crimson', 'Deep oxblood red with rose highlights, dark luxury red', '🍷', 'standard', {
        background: '348 50% 8%', card: '348 42% 20%', cardForeground: '10 50% 96%',
        primary: '4 58% 52%', muted: '348 35% 10%', mutedForeground: '348 20% 58%',
        destructive: '0 72% 45%', border: '348 35% 22%',
    }, { subcategory: 'dark' }),
    theme('volcano', 'Volcano', 'Molten lava orange and red glowing on volcanic black rock', '🌋', 'standard', {
        background: '15 30% 6%', card: '15 25% 12%', cardForeground: '30 50% 95%',
        primary: '15 90% 55%', primaryForeground: '15 30% 5%',
        muted: '15 18% 9%', mutedForeground: '25 50% 58%',
        destructive: '0 85% 55%', border: '15 20% 18%', ring: '35 90% 55%',
    }, { subcategory: 'dark' }),
    theme('ember', 'Ember', 'Deep burnt charcoal with glowing ember orange', '🔥', 'standard', {
        background: '25 65% 7%', card: '25 55% 17%', cardForeground: '36 75% 88%',
        primary: '22 92% 48%', muted: '25 45% 11%', mutedForeground: '30 35% 55%',
        destructive: '0 65% 45%', border: '25 45% 25%',
    }, { subcategory: 'dark' }),
    theme('dusk', 'Dusk', 'Blue-gray overcast evening with warm sunset orange, the hour between day and night', '🌆', 'standard', {
        background: '225 15% 22%', card: '225 12% 28%', cardForeground: '40 30% 93%',
        primary: '25 80% 58%', primaryForeground: '225 15% 10%',
        muted: '225 10% 18%', mutedForeground: '30 20% 60%',
        destructive: '0 65% 50%', border: '225 12% 34%',
    }, { subcategory: 'dark' }),
    theme('sunset', 'Sunset', 'Warm oranges and golden hour vibes', '🌅', 'standard', {
        background: '20 25% 8%', card: '20 20% 19%', cardForeground: '33 100% 96%',
        primary: '27 96% 61%', muted: '20 17% 12%', mutedForeground: '27 97% 72%',
        destructive: '0 63% 31%', border: '20 15% 27%',
    }, { subcategory: 'dark' }),
    theme('gruvbox-dark', 'Gruvbox Dark', 'Retro groove color scheme', '📻', 'standard', {
        background: '0 0% 16%', card: '20 5% 23%', cardForeground: '43 47% 81%',
        primary: '27 99% 55%', muted: '20 5% 19%', mutedForeground: '34 22% 59%',
        destructive: '1 73% 46%', border: '20 5% 30%',
    }, { subcategory: 'dark' }),
    theme('parchment-dark', 'Parchment Dark', 'Aged paper at night, rich warm brown with glowing amber accent', '🕯️', 'standard', {
        background: '25 30% 14%', card: '25 25% 22%', cardForeground: '36 40% 88%',
        primary: '30 75% 55%', muted: '25 22% 17%', mutedForeground: '30 20% 57%',
        destructive: '0 65% 45%', border: '25 22% 34%',
    }, { subcategory: 'dark' }),
    theme('city-sunset', 'City Sunset', 'Golden coral and rose on deep purple, skyline at golden hour', '🌇', 'standard', {
        background: '289 83% 8%', card: '325 40% 13%', cardForeground: '30 50% 95%',
        primary: '33 81% 60%', primaryForeground: '289 83% 8%',
        muted: '300 40% 11%', mutedForeground: '30 30% 65%',
        destructive: '353 80% 55%', border: '300 35% 20%',
    }, { subcategory: 'dark' }),
    theme('cream-coffee', 'Cream Coffee', 'Warm espresso browns with latte accents, cozy and inviting', '☕', 'standard', {
        background: '27 58% 6%', card: '27 40% 11%', cardForeground: '34 30% 90%',
        primary: '34 60% 65%', primaryForeground: '27 58% 6%',
        muted: '27 35% 9%', mutedForeground: '34 20% 60%',
        destructive: '0 60% 45%', border: '27 30% 18%',
    }, { subcategory: 'dark' }),
    theme('amber-glass', 'Amber Glass', 'Honey and amber on deep brown, warm golden hour nostalgic', '🍯', 'standard', {
        background: '32 75% 6%', card: '32 65% 17%', cardForeground: '42 80% 88%',
        primary: '38 88% 51%', muted: '32 55% 10%', mutedForeground: '35 40% 52%',
        destructive: '0 65% 45%', border: '32 50% 24%',
    }, { subcategory: 'dark' }),
    theme('obsidian-gold', 'Obsidian Gold', 'Pure black with warm 24k gold accents, luxury contrast', '✦', 'standard', {
        background: '0 0% 4%', card: '0 0% 17%', cardForeground: '36 50% 93%',
        primary: '38 65% 55%', muted: '0 0% 6%', mutedForeground: '35 12% 53%',
        destructive: '0 65% 45%', border: '0 0% 18%',
    }, { subcategory: 'dark' }),
    theme('ayu-mirage', 'Ayu Mirage', 'Simple, bright and elegant theme', '🌅', 'standard', {
        background: '223 22% 16%', card: '222 22% 24%', cardForeground: '60 4% 79%',
        primary: '40 100% 70%', muted: '222 22% 19%', mutedForeground: '219 11% 53%',
        destructive: '7 81% 71%', border: '222 22% 30%',
    }, { subcategory: 'dark' }),
    theme('monokai-pro', 'Monokai Pro', 'Beautiful functionality for pro dev', '🍌', 'standard', {
        background: '300 4% 17%', card: '300 4% 24%', cardForeground: '60 40% 98%',
        primary: '45 100% 70%', muted: '300 4% 20%', mutedForeground: '300 2% 56%',
        destructive: '345 100% 69%', border: '300 4% 31%',
    }, { subcategory: 'dark' }),
    theme('cafe', 'Café', 'Warm coffee tones for focus', '☕', 'standard', {
        background: '24 20% 9%', card: '24 16% 19%', cardForeground: '44 87% 94%',
        primary: '45 93% 47%', muted: '24 14% 13%', mutedForeground: '48 96% 72%',
        destructive: '0 63% 31%', border: '24 13% 27%',
    }, { subcategory: 'dark' }),
    theme('stained-glass', 'Stained Glass', 'Cathedral glass panels, rich jewel colors with golden leading', '🏛️', 'standard', {
        background: '260 30% 6%', card: '260 25% 11%', cardForeground: '45 40% 93%',
        primary: '45 90% 55%', primaryForeground: '260 30% 5%',
        muted: '260 18% 9%', mutedForeground: '45 30% 55%',
        destructive: '350 70% 55%', border: '260 20% 17%', ring: '190 60% 55%',
    }, { subcategory: 'dark' }),
    theme('royal', 'Royal', 'Deep purple and gold crown jewels, regal and luxurious', '👑', 'standard', {
        background: '275 35% 7%', card: '275 28% 13%', cardForeground: '45 40% 94%',
        primary: '45 85% 55%', primaryForeground: '275 35% 5%',
        muted: '275 22% 10%', mutedForeground: '45 30% 55%',
        destructive: '0 70% 50%', border: '275 22% 19%', ring: '275 60% 50%',
    }, { subcategory: 'dark' }),
    theme('midnight-carnival', 'Midnight Carnival', 'Circus lights at midnight, festive neon on starless black', '🎪', 'standard', {
        background: '240 30% 5%', card: '240 22% 10%', cardForeground: '50 30% 95%',
        primary: '45 90% 55%', primaryForeground: '240 30% 4%',
        muted: '240 15% 8%', mutedForeground: '320 40% 58%',
        destructive: '0 75% 55%', border: '240 18% 16%', ring: '320 80% 58%',
    }, { subcategory: 'dark' }),
    theme('cobalt2', 'Cobalt2', 'Blue-yellow high contrast theme by Wes Bos', '🔥', 'standard', {
        background: '205 49% 19%', card: '207 51% 27%', cardForeground: '0 0% 93%',
        primary: '47 100% 50%', muted: '207 51% 22%', mutedForeground: '206 11% 58%',
        destructive: '344 100% 69%', border: '207 51% 35%',
    }, { subcategory: 'dark' }),
    theme('toxic-waste', 'Toxic Waste', 'Radioactive hazard green and yellow, biohazard warning', '☢️', 'standard', {
        background: '80 25% 6%', card: '80 20% 12%', cardForeground: '60 40% 95%',
        primary: '75 90% 50%', primaryForeground: '80 25% 5%',
        muted: '80 15% 9%', mutedForeground: '60 35% 58%',
        destructive: '0 80% 50%', border: '80 15% 18%', ring: '50 100% 52%',
    }, { subcategory: 'dark' }),
    theme('oled-red', 'OLED Red', 'Pure black void with blood red crimson glow', '🔴', 'standard', {
        background: '0 0% 0%', card: '0 0% 5%', cardForeground: '0 0% 98%',
        primary: '0 80% 50%', primaryForeground: '0 0% 0%',
        muted: '0 0% 3%', mutedForeground: '0 0% 58%',
        destructive: '0 90% 45%', border: '0 30% 12%',
    }, { subcategory: 'oled' }),
    theme('oled-orange', 'OLED Orange', 'Pure black void with radioactive molten orange', '🟠', 'standard', {
        background: '0 0% 0%', card: '0 0% 5%', cardForeground: '0 0% 98%',
        primary: '25 100% 52%', primaryForeground: '0 0% 0%',
        muted: '0 0% 3%', mutedForeground: '0 0% 58%',
        destructive: '0 80% 55%', border: '25 40% 12%',
    }, { subcategory: 'oled' }),
    theme('oled-yellow', 'OLED Yellow', 'Pure black void with electric radioactive yellow', '🟡', 'standard', {
        background: '0 0% 0%', card: '0 0% 5%', cardForeground: '0 0% 98%',
        primary: '52 100% 52%', primaryForeground: '0 0% 0%',
        muted: '0 0% 3%', mutedForeground: '0 0% 58%',
        destructive: '0 80% 55%', border: '50 40% 12%',
    }, { subcategory: 'oled' }),
    theme('oled-lime', 'OLED Lime', 'Pure black void with acidic lime shock', '🟢', 'standard', {
        background: '0 0% 0%', card: '0 0% 5%', cardForeground: '0 0% 98%',
        primary: '75 100% 50%', primaryForeground: '0 0% 0%',
        muted: '0 0% 3%', mutedForeground: '0 0% 58%',
        destructive: '0 80% 55%', border: '75 40% 12%',
    }, { subcategory: 'oled' }),
    theme('dusty-sage', 'Dusty Sage', 'Soft sage green with blush rose accents, gentle and natural light theme', '🌿', 'standard', {
        background: '95 20% 90%', card: '16 67% 98%', cardForeground: '117 9% 22%',
        primary: '101 19% 45%', primaryForeground: '95 20% 95%',
        muted: '95 15% 88%', mutedForeground: '117 8% 38%',
        destructive: '0 60% 50%', border: '95 12% 80%',
    }, { subcategory: 'light' }),
    theme('spring-meadow', 'Spring Meadow', 'Fresh dewy grass and wildflowers, vibrant new growth', '🌱', 'standard', {
        background: '110 35% 92%', card: '100 25% 98%', cardForeground: '110 35% 14%',
        primary: '105 55% 40%', primaryForeground: '0 0% 100%',
        muted: '110 22% 89%', mutedForeground: '110 20% 30%',
        destructive: '0 72% 45%', border: '110 18% 78%',
    }, { subcategory: 'light' }),
    theme('forest-canopy', 'Forest Canopy', 'Deep forest green with lighter mossy cards, dappled woodland light', '🌲', 'standard', {
        background: '120 18% 76%', card: '120 22% 85%', cardForeground: '120 30% 13%',
        primary: '120 45% 30%', primaryForeground: '0 0% 100%',
        muted: '120 12% 70%', mutedForeground: '120 20% 28%',
        destructive: '0 72% 45%', border: '120 15% 65%',
    }, { subcategory: 'light' }),
    theme('light-mint', 'Light Mint', 'Fresh mint green, clean and crisp like a spring morning', '🍃', 'standard', {
        background: '150 30% 93%', card: '150 20% 99%', cardForeground: '150 35% 15%',
        primary: '155 55% 40%', primaryForeground: '0 0% 100%',
        muted: '150 22% 90%', mutedForeground: '150 20% 32%',
        destructive: '0 72% 45%', border: '150 18% 80%',
    }, { subcategory: 'light' }),
    theme('mint-meadow', 'Mint Meadow', 'Fresh mint green with lighter jade cards, cool spring dew', '🦌', 'standard', {
        background: '155 20% 76%', card: '155 25% 86%', cardForeground: '155 28% 13%',
        primary: '160 45% 35%', primaryForeground: '0 0% 100%',
        muted: '155 14% 70%', mutedForeground: '155 18% 28%',
        destructive: '0 72% 45%', border: '155 16% 64%',
    }, { subcategory: 'light' }),
    theme('seafoam-light', 'Seafoam', 'Light airy seafoam green, coastal and breezy', '🌊', 'standard', {
        background: '165 30% 92%', card: '160 20% 98%', cardForeground: '165 30% 13%',
        primary: '168 50% 40%', primaryForeground: '0 0% 100%',
        muted: '165 20% 89%', mutedForeground: '165 18% 30%',
        destructive: '0 72% 45%', border: '165 16% 78%',
    }, { subcategory: 'light' }),
    theme('turquoise', 'Turquoise', 'Vibrant jewel turquoise, crystal clear Caribbean water', '💠', 'standard', {
        background: '175 48% 89%', card: '175 33% 96%', cardForeground: '175 45% 13%',
        primary: '174 72% 42%', primaryForeground: '0 0% 100%',
        muted: '175 25% 83%', mutedForeground: '175 22% 30%',
        destructive: '0 80% 50%', border: '175 20% 72%', ring: '195 70% 50%',
    }, { subcategory: 'light' }),
    theme('lagoon', 'Lagoon', 'Tropical turquoise lagoon water, crystal clear and inviting', '🏖️', 'standard', {
        background: '185 35% 91%', card: '185 25% 98%', cardForeground: '190 30% 13%',
        primary: '188 60% 42%', primaryForeground: '0 0% 100%',
        muted: '185 22% 88%', mutedForeground: '190 20% 30%',
        destructive: '0 72% 45%', border: '185 18% 76%',
    }, { subcategory: 'light' }),
    theme('hoth', 'Hoth', 'Frosted whites with glacial accents', '❄️', 'standard', {
        background: '210 40% 98%', card: '0 0% 100%', cardForeground: '222 84% 5%',
        primary: '199 89% 37%', muted: '210 40% 95%', mutedForeground: '215 16% 38%',
        destructive: '0 84% 60%', border: '214 32% 68%',
    }, { subcategory: 'light' }),
    theme('light-sky', 'Light Sky', 'Open sky blue, airy and optimistic', '☁️', 'standard', {
        background: '210 30% 93%', card: '210 20% 99%', cardForeground: '210 35% 12%',
        primary: '205 65% 48%', primaryForeground: '0 0% 100%',
        muted: '210 22% 90%', mutedForeground: '210 18% 35%',
        destructive: '0 72% 45%', border: '210 18% 80%',
    }, { subcategory: 'light' }),
    theme('cotton-candy', 'Cotton Candy', 'Fluffy pink and blue carnival sweetness, funfair nostalgia', '🎪', 'standard', {
        background: '200 30% 92%', card: '330 25% 99%', cardForeground: '220 30% 14%',
        primary: '205 60% 50%', primaryForeground: '0 0% 100%',
        muted: '330 20% 90%', mutedForeground: '330 18% 33%',
        destructive: '0 72% 45%', border: '200 16% 78%', ring: '330 45% 55%',
    }, { subcategory: 'light' }),
    theme('ocean-mist', 'Ocean Mist', 'Cool blue-gray haze with deeper blue cards, overcast coastal morning', '🌫️', 'standard', {
        background: '210 20% 80%', card: '210 25% 88%', cardForeground: '215 35% 15%',
        primary: '210 55% 40%', primaryForeground: '0 0% 100%',
        muted: '210 15% 74%', mutedForeground: '215 20% 30%',
        destructive: '0 72% 45%', border: '210 18% 68%',
    }, { subcategory: 'light' }),
    theme('vellum', 'Vellum', 'Cooler grey-cream with deep blue ink, quality paper aesthetic', '🗒️', 'standard', {
        background: '45 20% 90%', card: '45 15% 98%', cardForeground: '220 25% 16%',
        primary: '215 60% 45%', muted: '45 12% 92%', mutedForeground: '220 12% 24%',
        destructive: '0 72% 45%', border: '45 15% 72%',
    }, { subcategory: 'light' }),
    theme('light', 'Light', 'Bright and clean interface', '☀️', 'standard', {
        background: '0 0% 100%', card: '0 0% 98%', cardForeground: '222 84% 5%',
        primary: '221 83% 53%', muted: '220 14% 95%', mutedForeground: '220 9% 46%',
        destructive: '0 84% 60%', border: '220 13% 70%',
    }, { subcategory: 'light' }),
    theme('cornflower', 'Cornflower', 'Bright cornflower blue, vivid and cheerful like a summer wildflower field', '🌸', 'standard', {
        background: '220 40% 91%', card: '220 28% 97%', cardForeground: '220 40% 13%',
        primary: '220 70% 50%', primaryForeground: '0 0% 100%',
        muted: '220 22% 85%', mutedForeground: '220 18% 32%',
        destructive: '0 72% 45%', border: '220 18% 76%',
    }, { subcategory: 'light' }),
    theme('indigo-light', 'Indigo Light', 'Deep indigo denim blue, rich and confident like a faded jeans jacket', '👖', 'standard', {
        background: '235 35% 90%', card: '235 25% 96%', cardForeground: '235 40% 13%',
        primary: '235 60% 47%', primaryForeground: '0 0% 100%',
        muted: '235 20% 84%', mutedForeground: '235 18% 32%',
        destructive: '0 72% 45%', border: '235 16% 74%',
    }, { subcategory: 'light' }),
    theme('periwinkle', 'Periwinkle', 'Soft periwinkle blue-purple, gentle and dreamy like twilight flowers', '💠', 'standard', {
        background: '240 30% 91%', card: '240 20% 97%', cardForeground: '240 35% 13%',
        primary: '240 50% 55%', primaryForeground: '0 0% 100%',
        muted: '240 18% 85%', mutedForeground: '240 16% 32%',
        destructive: '0 72% 45%', border: '240 15% 75%', ring: '210 55% 55%',
    }, { subcategory: 'light' }),
    theme('everforest', 'Everforest', 'Deep emerald forest with warm stone accents', '🌲', 'standard', {
        background: '210 12% 18%', card: '210 10% 26%', cardForeground: '42 30% 83%',
        primary: '95 33% 63%', muted: '210 10% 21%', mutedForeground: '150 8% 55%',
        destructive: '0 55% 55%', border: '210 10% 33%',
    }, { subcategory: 'dark' }),
    theme('aurora-borealis', 'Aurora Borealis', 'Vivid green and pink northern lights dancing over arctic night', '🌌', 'standard', {
        background: '220 40% 7%', card: '220 32% 13%', cardForeground: '140 20% 95%',
        primary: '140 70% 55%', primaryForeground: '220 40% 5%',
        muted: '220 25% 10%', mutedForeground: '280 40% 60%',
        destructive: '0 70% 50%', border: '220 25% 19%', ring: '310 70% 60%',
    }, { subcategory: 'dark' }),
    theme('choco-mint', 'Choco Mint', 'Earthy neutrals with mint highlights', '🍫', 'standard', {
        background: '120 10% 11%', card: '120 10% 20%', cardForeground: '120 60% 97%',
        primary: '142 71% 38%', muted: '120 10% 15%', mutedForeground: '142 77% 73%',
        destructive: '0 63% 31%', border: '120 10% 27%',
    }, { subcategory: 'dark' }),
    theme('emerald', 'Emerald', 'Rich green gemstone, deep luxurious emerald facets', '💎', 'standard', {
        background: '155 40% 8%', card: '155 35% 14%', cardForeground: '150 30% 95%',
        primary: '155 75% 48%', primaryForeground: '155 40% 5%',
        muted: '155 25% 11%', mutedForeground: '150 25% 58%',
        destructive: '0 70% 50%', border: '155 28% 20%',
    }, { subcategory: 'dark' }),
    theme('clinical-mint', 'Clinical Mint', 'Medical-grade dusty mint on deep slate, clean and restorative', '🌿', 'standard', {
        background: '168 22% 9%', card: '168 18% 19%', cardForeground: '160 40% 91%',
        primary: '165 65% 58%', muted: '168 15% 13%', mutedForeground: '165 33% 55%',
        destructive: '0 60% 45%', border: '168 15% 26%',
    }, { subcategory: 'dark' }),
    theme('mermaid', 'Mermaid', 'Iridescent deep sea, midnight teal with shimmering aqua', '🧜', 'standard', {
        background: '205 50% 11%', card: '205 44% 21%', cardForeground: '190 65% 94%',
        primary: '182 72% 67%', muted: '205 35% 15%', mutedForeground: '200 25% 56%',
        destructive: '0 60% 45%', border: '205 35% 28%',
    }, { subcategory: 'dark' }),
    theme('nord', 'Nord', 'Arctic, north-bluish color palette', '🏔️', 'standard', {
        background: '220 16% 22%', card: '220 17% 29%', cardForeground: '219 28% 88%',
        primary: '193 43% 67%', muted: '220 17% 25%', mutedForeground: '92 28% 65%',
        destructive: '354 42% 56%', border: '220 16% 36%',
    }, { subcategory: 'dark' }),
    theme('ochin', 'Ochin', 'Ocean blues with soft highlights', '🌊', 'standard', {
        background: '213 53% 10%', card: '213 40% 19%', cardForeground: '210 40% 98%',
        primary: '198 93% 60%', muted: '213 35% 12%', mutedForeground: '199 92% 75%',
        destructive: '0 63% 31%', border: '213 35% 24%',
    }, { subcategory: 'dark' }),
    theme('solarized-dark', 'Solarized Dark', 'Precision colors for machines and people', '🌤️', 'standard', {
        background: '192 100% 11%', card: '192 81% 18%', cardForeground: '186 9% 65%',
        primary: '205 69% 54%', muted: '192 81% 14%', mutedForeground: '194 14% 53%',
        destructive: '1 71% 52%', border: '192 81% 30%',
    }, { subcategory: 'dark' }),
    theme('one-dark-pro', 'One Dark Pro', 'Iconic Atom One Dark vibes', '⚛️', 'standard', {
        background: '220 13% 18%', card: '220 13% 25%', cardForeground: '219 14% 71%',
        primary: '207 82% 66%', muted: '216 13% 21%', mutedForeground: '219 10% 56%',
        destructive: '355 65% 65%', border: '216 13% 32%',
    }, { subcategory: 'dark' }),
    theme('github-dark-dimmed', 'GitHub Dark Dimmed', 'Softer contrast for less eye strain', '🐙', 'standard', {
        background: '215 15% 16%', card: '215 18% 23%', cardForeground: '210 17% 73%',
        primary: '213 90% 64%', muted: '215 18% 19%', mutedForeground: '210 10% 55%',
        destructive: '3 75% 60%', border: '215 18% 30%',
    }, { subcategory: 'dark' }),
    theme('sapphire', 'Sapphire', 'Deep blue gemstone, royal sapphire brilliance', '🔷', 'standard', {
        background: '220 50% 8%', card: '220 42% 14%', cardForeground: '210 25% 95%',
        primary: '215 80% 55%', primaryForeground: '220 50% 5%',
        muted: '220 30% 11%', mutedForeground: '210 25% 58%',
        destructive: '0 70% 50%', border: '220 30% 20%',
    }, { subcategory: 'dark' }),
    theme('nightfall', 'Nightfall', 'Balanced contrast for low-light focus', '🌙', 'standard', {
        background: '222 47% 11%', card: '217 33% 21%', cardForeground: '210 40% 98%',
        primary: '217 91% 60%', muted: '217 33% 15%', mutedForeground: '215 20% 65%',
        destructive: '0 63% 31%', border: '217 33% 28%', ring: '224 76% 48%',
    }, { subcategory: 'dark' }),
    theme('night-owl', 'Night Owl', 'Fine-tuned for late night coding', '🦉', 'standard', {
        background: '207 95% 8%', card: '207 92% 17%', cardForeground: '217 40% 88%',
        primary: '221 100% 75%', muted: '207 92% 10%', mutedForeground: '207 23% 48%',
        destructive: '3 86% 63%', border: '206 60% 21%',
    }, { subcategory: 'dark' }),
    theme('tokyo-night', 'Tokyo Night', 'A clean, dark theme that celebrates the lights of downtown Tokyo at night', '🗼', 'standard', {
        background: '235 19% 13%', card: '235 19% 23%', cardForeground: '229 59% 85%',
        primary: '226 90% 72%', muted: '240 15% 17%', mutedForeground: '229 23% 56%',
        destructive: '349 89% 72%', border: '228 23% 32%',
    }, { subcategory: 'dark' }),
    theme('oled-green', 'OLED Green', 'Pure black void with phosphorescent matrix green', '🟢', 'standard', {
        background: '0 0% 0%', card: '0 0% 5%', cardForeground: '0 0% 98%',
        primary: '120 100% 40%', primaryForeground: '0 0% 0%',
        muted: '0 0% 3%', mutedForeground: '0 0% 58%',
        destructive: '0 70% 50%', border: '120 30% 12%',
    }, { subcategory: 'oled' }),
    theme('high-contrast', 'High Contrast', 'WCAG AAA compliant, pure black with electric lime for maximum legibility', '♿', 'standard', {
        background: '0 0% 0%', card: '0 0% 6%', cardForeground: '0 0% 100%',
        primary: '151 100% 50%', muted: '0 0% 2%', mutedForeground: '0 0% 70%',
        destructive: '0 100% 60%', border: '0 0% 14%',
    }, { subcategory: 'oled' }),
    theme('oled-cyan', 'OLED Cyan', 'Pure black void with electric cyan arc', '🔵', 'standard', {
        background: '0 0% 0%', card: '0 0% 5%', cardForeground: '0 0% 98%',
        primary: '190 100% 50%', primaryForeground: '0 0% 0%',
        muted: '0 0% 3%', mutedForeground: '0 0% 58%',
        destructive: '0 70% 50%', border: '190 30% 12%',
    }, { subcategory: 'oled' }),
    theme('dark', 'Midnight', 'High-contrast OLED black', '🌑', 'standard', {
        background: '0 0% 0%', card: '0 0% 6%', cardForeground: '0 0% 98%',
        primary: '211 100% 50%', primaryForeground: '0 0% 100%',
        muted: '0 0% 2%', mutedForeground: '0 0% 64%',
        destructive: '0 63% 31%', border: '0 0% 14%', ring: '211 100% 50%',
    }, { subcategory: 'oled' }),
    theme('oled-teal', 'OLED Teal', 'Pure black void with deep tropical teal glow', '🟢', 'standard', {
        background: '0 0% 0%', card: '0 0% 5%', cardForeground: '0 0% 98%',
        primary: '170 100% 45%', primaryForeground: '0 0% 0%',
        muted: '0 0% 3%', mutedForeground: '0 0% 58%',
        destructive: '0 80% 55%', border: '170 40% 12%',
    }, { subcategory: 'oled' }),
    theme('oled-indigo', 'OLED Indigo', 'Pure black void with deep indigo wavelength', '🔵', 'standard', {
        background: '0 0% 0%', card: '0 0% 5%', cardForeground: '0 0% 98%',
        primary: '235 100% 60%', primaryForeground: '0 0% 0%',
        muted: '0 0% 3%', mutedForeground: '0 0% 58%',
        destructive: '0 80% 55%', border: '235 40% 12%',
    }, { subcategory: 'oled' }),
    theme('lavender-fields', 'Lavender Fields', 'Endless purple lavender rows under summer sun, Provence in bloom', '💜', 'standard', {
        background: '270 30% 92%', card: '270 20% 98%', cardForeground: '270 30% 14%',
        primary: '265 45% 50%', primaryForeground: '0 0% 100%',
        muted: '270 18% 89%', mutedForeground: '270 18% 32%',
        destructive: '0 72% 45%', border: '270 16% 78%',
    }, { subcategory: 'light' }),
    theme('catppuccin-latte', 'Catppuccin Latte', 'Our lightest theme harmoniously inverting the essence of Catppuccin', '☕', 'standard', {
        background: '220 23% 90%', card: '0 0% 100%', cardForeground: '234 16% 28%',
        primary: '266 85% 58%', muted: '220 23% 93%', mutedForeground: '231 10% 42%',
        destructive: '351 74% 57%', border: '231 10% 78%',
    }, { subcategory: 'light' }),
    theme('electric-violet', 'Electric Violet', 'Saturated electric purple, neon lavender energy', '⚡', 'standard', {
        background: '270 40% 90%', card: '270 28% 96%', cardForeground: '270 40% 14%',
        primary: '268 72% 52%', primaryForeground: '0 0% 100%',
        muted: '270 22% 84%', mutedForeground: '270 22% 32%',
        destructive: '0 80% 50%', border: '270 18% 74%', ring: '300 65% 55%',
    }, { subcategory: 'light' }),
    theme('pastel-dream', 'Pastel Dream', 'Soft purple pink and blue pastel gradient, dreamy and calming', '💭', 'standard', {
        background: '330 50% 91%', card: '205 50% 96%', cardForeground: '270 35% 18%',
        primary: '270 45% 55%', primaryForeground: '0 0% 100%',
        muted: '330 30% 88%', mutedForeground: '270 20% 38%',
        destructive: '0 72% 45%', border: '330 22% 80%', ring: '205 60% 55%',
    }, { subcategory: 'light' }),
    theme('berry-blush', 'Berry Blush', 'Soft berry purple with lighter lavender cards, fruit-infused warmth', '🫐', 'standard', {
        background: '280 18% 78%', card: '280 22% 87%', cardForeground: '280 28% 14%',
        primary: '280 40% 45%', primaryForeground: '0 0% 100%',
        muted: '280 12% 72%', mutedForeground: '280 18% 30%',
        destructive: '0 72% 45%', border: '280 16% 66%',
    }, { subcategory: 'light' }),
    theme('kawaii', 'Kawaii', 'Pink lavender baby blue and mint, adorable pastel rainbow candy', '🍬', 'standard', {
        background: '320 35% 93%', card: '320 25% 99%', cardForeground: '320 35% 15%',
        primary: '320 45% 55%', primaryForeground: '0 0% 100%',
        muted: '280 25% 90%', mutedForeground: '300 20% 38%',
        destructive: '0 72% 45%', border: '300 20% 80%', ring: '260 40% 60%',
    }, { subcategory: 'light' }),
    theme('candy', 'Candy', 'Rainbow candy shop, bright playful sugar rush colors', '🍭', 'standard', {
        background: '280 35% 91%', card: '40 40% 97%', cardForeground: '280 35% 15%',
        primary: '320 70% 50%', primaryForeground: '0 0% 100%',
        muted: '280 22% 85%', mutedForeground: '280 20% 33%',
        destructive: '0 75% 50%', border: '280 18% 76%', ring: '50 80% 50%',
    }, { subcategory: 'light' }),
    theme('bubblegum', 'Bubblegum', 'Bright bubblegum pink pop, playful and unapologetically fun', '🫧', 'standard', {
        background: '325 40% 92%', card: '325 28% 98%', cardForeground: '325 35% 14%',
        primary: '325 65% 50%', primaryForeground: '0 0% 100%',
        muted: '325 25% 89%', mutedForeground: '325 22% 33%',
        destructive: '0 72% 45%', border: '325 20% 78%',
    }, { subcategory: 'light' }),
    theme('faded-rose', 'Faded Rose', 'Vintage mauve and dusty rose with sage teal, antique and faded', '🌹', 'standard', {
        background: '0 24% 89%', card: '60 4% 96%', cardForeground: '328 18% 28%',
        primary: '328 18% 48%', primaryForeground: '0 24% 95%',
        muted: '0 18% 86%', mutedForeground: '328 12% 38%',
        destructive: '0 60% 48%', border: '0 12% 78%',
    }, { subcategory: 'light' }),
    theme('dragon-fruit', 'Dragon Fruit', 'Tropical dragon fruit, vibrant pink flesh with green scales', '🐉', 'standard', {
        background: '330 40% 90%', card: '140 35% 96%', cardForeground: '330 40% 14%',
        primary: '330 65% 50%', primaryForeground: '0 0% 100%',
        muted: '330 22% 84%', mutedForeground: '330 20% 32%',
        destructive: '0 72% 45%', border: '330 18% 76%', ring: '140 50% 38%',
    }, { subcategory: 'light' }),
    theme('linen', 'Linen', 'Warm off-white linen with dusty rose accent, soft and tactile', '🧵', 'standard', {
        background: '25 30% 91%', card: '25 20% 98%', cardForeground: '340 20% 15%',
        primary: '340 45% 42%', muted: '25 18% 93%', mutedForeground: '340 12% 25%',
        destructive: '0 72% 45%', border: '25 18% 74%',
    }, { subcategory: 'light' }),
    theme('light-rose', 'Light Rose', 'Bright and airy rose pink, fresh and modern', '🌸', 'standard', {
        background: '340 40% 93%', card: '340 30% 99%', cardForeground: '340 40% 15%',
        primary: '340 60% 45%', primaryForeground: '0 0% 100%',
        muted: '340 25% 90%', mutedForeground: '340 20% 35%',
        destructive: '0 72% 45%', border: '340 20% 80%',
    }, { subcategory: 'light' }),
    theme('sakura', 'Sakura', 'Cherry blossom petals drifting on a spring breeze, delicate and serene', '🌸', 'standard', {
        background: '340 30% 93%', card: '340 20% 99%', cardForeground: '340 30% 14%',
        primary: '340 50% 48%', primaryForeground: '0 0% 100%',
        muted: '340 18% 90%', mutedForeground: '340 18% 32%',
        destructive: '0 72% 45%', border: '340 16% 78%',
    }, { subcategory: 'light' }),
    theme('rose-quartz', 'Rose Quartz', 'Warm rose pink with lighter blush cards, crystal healing warmth', '💗', 'standard', {
        background: '340 22% 78%', card: '340 28% 87%', cardForeground: '340 28% 14%',
        primary: '340 50% 42%', primaryForeground: '0 0% 100%',
        muted: '340 15% 72%', mutedForeground: '340 18% 30%',
        destructive: '0 72% 45%', border: '340 18% 66%',
    }, { subcategory: 'light' }),
    theme('tropical-punch', 'Tropical Punch', 'Vibrant fruit punch, tropical sunset over jungle canopy', '🍹', 'standard', {
        background: '15 45% 90%', card: '35 40% 96%', cardForeground: '340 40% 14%',
        primary: '340 70% 48%', primaryForeground: '0 0% 100%',
        muted: '15 28% 84%', mutedForeground: '340 22% 32%',
        destructive: '0 75% 50%', border: '15 20% 74%', ring: '150 45% 38%',
    }, { subcategory: 'light' }),
    theme('ice-cream', 'Ice Cream', 'Mint strawberry and vanilla pastel, sweet and creamy summer treat', '🍨', 'standard', {
        background: '160 30% 91%', card: '0 40% 97%', cardForeground: '160 35% 14%',
        primary: '340 50% 52%', primaryForeground: '0 0% 100%',
        muted: '160 20% 85%', mutedForeground: '160 20% 32%',
        destructive: '0 72% 45%', border: '160 16% 76%', ring: '160 45% 42%',
    }, { subcategory: 'light' }),
    theme('hot-coral', 'Hot Coral', 'Vivid punchy coral and salmon, hotter than a tropical sunset', '🔥', 'standard', {
        background: '8 55% 90%', card: '8 40% 96%', cardForeground: '350 50% 14%',
        primary: '350 72% 50%', primaryForeground: '0 0% 100%',
        muted: '8 28% 84%', mutedForeground: '350 25% 33%',
        destructive: '0 80% 50%', border: '8 22% 74%', ring: '25 80% 55%',
    }, { subcategory: 'light' }),
    theme('watermelon', 'Watermelon', 'Summer watermelon, pink flesh and green rind with seed accents', '🍉', 'standard', {
        background: '140 35% 88%', card: '350 45% 95%', cardForeground: '140 40% 14%',
        primary: '350 65% 48%', primaryForeground: '0 0% 100%',
        muted: '140 22% 82%', mutedForeground: '140 22% 30%',
        destructive: '0 72% 45%', border: '140 18% 76%', ring: '140 50% 38%',
    }, { subcategory: 'light' }),
    theme('manuscript', 'Manuscript', 'Neutral parchment with crimson ink, illuminated manuscript vibes', '✍️', 'standard', {
        background: '50 15% 88%', card: '50 10% 96%', cardForeground: '230 30% 15%',
        primary: '355 60% 38%', muted: '50 12% 91%', mutedForeground: '230 15% 25%',
        destructive: '0 72% 45%', border: '50 12% 70%',
    }, { subcategory: 'light' }),
    theme('light-retro', 'Light Retro', 'Dusty pink and coral with sand and pale teal, vintage warmth', '📅', 'standard', {
        background: '345 30% 90%', card: '40 40% 97%', cardForeground: '345 35% 15%',
        primary: '355 93% 68%', primaryForeground: '0 0% 100%',
        muted: '60 25% 88%', mutedForeground: '180 15% 35%',
        destructive: '0 72% 45%', border: '40 25% 75%', ring: '42 45% 56%',
    }, { subcategory: 'light' }),
    theme('comic-book', 'Comic Book', 'Bold primary colors and thick black borders, pop art halftone', '💥', 'standard', {
        background: '0 0% 96%', card: '0 0% 100%', cardForeground: '0 0% 10%',
        primary: '355 85% 50%', primaryForeground: '0 0% 100%',
        muted: '0 0% 90%', mutedForeground: '0 0% 30%',
        destructive: '0 90% 50%', border: '0 0% 15%', ring: '215 90% 50%',
    }, { subcategory: 'light', customCss: `[class*="bg-card"]:not([class*="bg-card-"]) { border: 2px solid hsl(0 0% 10%) !important; border-radius: 4px !important; box-shadow: 3px 3px 0 hsl(0 0% 10%) !important; } [class*="btn"]:not([class*="btn-"]), button[class*="default"] { border: 2px solid hsl(0 0% 10%) !important; border-radius: 4px !important; box-shadow: 2px 2px 0 hsl(0 0% 10%) !important; } [class*="rounded"]:not([class*="rounded-"]) { border-radius: 4px !important; }` }),
    theme('deep-space', 'Deep Space', 'Near-black indigo with electric violet, deeper and more cosmic than Aurora', '🪐', 'standard', {
        background: '244 55% 6%', card: '244 45% 25%', cardForeground: '250 60% 95%',
        primary: '262 80% 62%', muted: '244 38% 8%', mutedForeground: '248 22% 56%',
        destructive: '0 65% 45%', border: '244 38% 22%',
    }, { subcategory: 'dark' }),
    theme('dracula', 'Dracula', 'The classic developer theme', '🧛', 'standard', {
        background: '231 15% 18%', card: '232 14% 27%', cardForeground: '60 30% 96%',
        primary: '265 89% 78%', muted: '232 14% 22%', mutedForeground: '225 27% 62%',
        destructive: '0 100% 67%', border: '232 14% 35%',
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
    theme('amethyst', 'Amethyst', 'Deep purple gemstone, mystical amethyst crystal', '🔮', 'standard', {
        background: '270 35% 8%', card: '270 28% 14%', cardForeground: '270 25% 95%',
        primary: '270 65% 58%', primaryForeground: '270 35% 5%',
        muted: '270 22% 11%', mutedForeground: '270 22% 58%',
        destructive: '0 70% 50%', border: '270 25% 20%',
    }, { subcategory: 'dark' }),
    theme('gamer', 'Gamer', 'RGB gaming setup, purple and cyan on stealth black', '🎮', 'standard', {
        background: '260 25% 6%', card: '260 20% 11%', cardForeground: '0 0% 95%',
        primary: '270 80% 55%', primaryForeground: '260 25% 4%',
        muted: '260 15% 9%', mutedForeground: '190 30% 55%',
        destructive: '0 75% 55%', border: '260 18% 17%', ring: '180 100% 50%',
    }, { subcategory: 'dark' }),
    theme('aurora', 'Aurora', 'Violet twilight with neon glow', '🌌', 'standard', {
        background: '229 35% 12%', card: '228 24% 23%', cardForeground: '240 100% 98%',
        primary: '271 91% 65%', muted: '228 22% 16%', mutedForeground: '229 84% 81%',
        destructive: '347 77% 50%', border: '228 20% 31%',
    }, { subcategory: 'dark' }),
    theme('material-palenight', 'Material Palenight', 'Elegant and juicy Material Design theme', '🎨', 'standard', {
        background: '228 20% 20%', card: '229 23% 29%', cardForeground: '231 28% 73%',
        primary: '276 68% 74%', muted: '229 23% 24%', mutedForeground: '231 18% 60%',
        destructive: '357 80% 69%', border: '229 23% 35%',
    }, { subcategory: 'dark' }),
    theme('aubergine', 'Aubergine', 'Rich purples with vibrant highlights', '🍆', 'standard', {
        background: '277 43% 11%', card: '277 30% 23%', cardForeground: '270 100% 98%',
        primary: '277 70% 63%', muted: '277 26% 16%', mutedForeground: '277 53% 86%',
        destructive: '347 77% 50%', border: '277 23% 34%',
    }, { subcategory: 'dark' }),
    theme('catppuccin-frappe', 'Catppuccin Frappé', 'A less vibrant alternative using subdued colors for a muted aesthetic', '☕', 'standard', {
        background: '229 19% 23%', card: '229 19% 30%', cardForeground: '227 70% 87%',
        primary: '277 59% 76%', muted: '229 19% 27%', mutedForeground: '229 14% 65%',
        destructive: '354 75% 67%', border: '229 14% 52%',
    }, { subcategory: 'dark' }),
    theme('cyberpunk', 'Cyberpunk', 'Neon pink and cyan on dark', '🤖', 'standard', {
        background: '240 33% 4%', card: '240 20% 20%', cardForeground: '300 100% 98%',
        primary: '292 91% 83%', muted: '240 17% 6%', mutedForeground: '187 92% 69%',
        destructive: '338 100% 50%', border: '240 15% 18%', ring: '180 100% 50%',
    }, { subcategory: 'dark' }),
    theme('downtown', 'Down Town', 'Magenta and sky-blue neon on dark eggplant, after-hours cityscape', '🌃', 'standard', {
        background: '237 21% 11%', card: '263 30% 17%', cardForeground: '290 30% 92%',
        primary: '296 84% 68%', primaryForeground: '237 21% 8%',
        muted: '250 20% 14%', mutedForeground: '280 15% 60%',
        destructive: '0 70% 50%', border: '260 25% 25%', ring: '214 100% 74%',
    }, { subcategory: 'dark' }),
    theme('twilight', 'Twilight', 'Deep mauve-purple medium tone with soft pink accent, dusk turning to night', '🌺', 'standard', {
        background: '280 18% 20%', card: '280 15% 27%', cardForeground: '320 35% 94%',
        primary: '320 65% 60%', primaryForeground: '280 18% 8%',
        muted: '280 12% 16%', mutedForeground: '310 35% 60%',
        destructive: '0 65% 50%', border: '280 25% 35%',
    }, { subcategory: 'dark' }),
    theme('neon-dream', 'Neon Dream', 'Multi-color neon fusion, pink cyan and yellow on void', '🌈', 'standard', {
        background: '270 30% 5%', card: '270 22% 10%', cardForeground: '0 0% 95%',
        primary: '320 100% 55%', primaryForeground: '270 30% 4%',
        muted: '270 15% 8%', mutedForeground: '190 40% 55%',
        destructive: '0 80% 55%', border: '270 18% 16%', ring: '180 100% 50%',
    }, { subcategory: 'dark' }),
    theme('synthwave', 'Synthwave', '80s retro vibes with neon gradients', '🎮', 'standard', {
        background: '277 30% 11%', card: '277 26% 23%', cardForeground: '300 100% 100%',
        primary: '324 100% 70%', muted: '277 24% 16%', mutedForeground: '200 100% 79%',
        destructive: '347 100% 61%', border: '277 22% 29%',
    }, { subcategory: 'dark' }),
    theme('rose-gold', 'Rose Gold', 'Soft pinks and elegant golds', '🌸', 'standard', {
        background: '340 15% 9%', card: '340 13% 20%', cardForeground: '327 73% 97%',
        primary: '330 81% 55%', muted: '340 12% 13%', mutedForeground: '330 90% 82%',
        destructive: '0 63% 31%', border: '340 11% 29%',
    }, { subcategory: 'dark' }),
    theme('ruby', 'Ruby', 'Deep red gemstone, passionate ruby glow', '❤️', 'standard', {
        background: '348 40% 8%', card: '348 35% 14%', cardForeground: '0 20% 96%',
        primary: '348 78% 55%', primaryForeground: '348 40% 5%',
        muted: '348 25% 11%', mutedForeground: '0 20% 58%',
        destructive: '0 80% 55%', border: '348 28% 20%',
    }, { subcategory: 'dark' }),
    theme('poison-apple', 'Poison Apple', 'Dark fairy tale, poisoned green glow with blood red apple', '🍎', 'standard', {
        background: '140 20% 5%', card: '140 15% 10%', cardForeground: '0 20% 95%',
        primary: '350 75% 50%', primaryForeground: '140 20% 4%',
        muted: '140 12% 8%', mutedForeground: '100 25% 55%',
        destructive: '0 80% 55%', border: '140 12% 16%', ring: '100 50% 40%',
    }, { subcategory: 'dark' }),
    theme('kanagawa', 'Kanagawa', 'Deep ink blues with warm lotus red, calm, focused, dramatic', '🏯', 'standard', {
        background: '240 14% 14%', card: '240 12% 24%', cardForeground: '47 45% 86%',
        primary: '351 62% 66%', muted: '240 12% 18%', mutedForeground: '240 6% 54%',
        destructive: '0 55% 50%', border: '240 12% 32%',
    }, { subcategory: 'dark' }),
    theme('oled-purple', 'OLED Purple', 'Pure black void with nebular violet glow', '🟣', 'standard', {
        background: '0 0% 0%', card: '0 0% 5%', cardForeground: '0 0% 98%',
        primary: '270 80% 60%', primaryForeground: '0 0% 0%',
        muted: '0 0% 3%', mutedForeground: '0 0% 58%',
        destructive: '0 70% 50%', border: '270 30% 12%',
    }, { subcategory: 'oled' }),
    theme('oled-pink', 'OLED Pink', 'Pure black void with radioactive hot pink meltdown', '💟', 'standard', {
        background: '0 0% 0%', card: '0 0% 5%', cardForeground: '0 0% 98%',
        primary: '330 100% 55%', primaryForeground: '0 0% 0%',
        muted: '0 0% 3%', mutedForeground: '0 0% 58%',
        destructive: '0 80% 55%', border: '330 40% 12%',
    }, { subcategory: 'oled' }),
    theme('oled-magenta', 'OLED Magenta', 'Pure black void with electric magenta fusion', '🟣', 'standard', {
        background: '0 0% 0%', card: '0 0% 5%', cardForeground: '0 0% 98%',
        primary: '300 100% 52%', primaryForeground: '0 0% 0%',
        muted: '0 0% 3%', mutedForeground: '0 0% 58%',
        destructive: '0 80% 55%', border: '300 40% 12%',
    }, { subcategory: 'oled' }),
    theme('slate-mono', 'Slate Mono', 'Pure monochrome, zero hue, maximum focus, zero distraction', '🪨', 'standard', {
        background: '0 0% 9%', card: '0 0% 20%', cardForeground: '0 0% 98%',
        primary: '0 0% 88%', muted: '0 0% 10%', mutedForeground: '0 0% 50%',
        destructive: '0 65% 50%', border: '0 0% 22%', ring: '0 0% 98%',
    }, { subcategory: 'dark' }),
    theme('eclipse', 'Eclipse', 'Lossless music player with vinyl eclipse aesthetic, navy and red-orange', '🎵', 'community', {
        background: '240 70% 7%', card: '240 50% 12%', cardForeground: '0 0% 90%',
        primary: '4 100% 59%', primaryForeground: '240 70% 5%',
        muted: '240 40% 10%', mutedForeground: '240 15% 55%',
        destructive: '0 70% 50%', border: '240 35% 18%',
    }, { subcategory: 'dark' }),
    theme('charmander', 'Charmander', 'Fire type, warm sunset orange with cream belly and yellow flame tail', '🦎', 'community', {
        background: '20 50% 86%', card: '35 45% 95%', cardForeground: '15 50% 14%',
        primary: '18 80% 48%', primaryForeground: '0 0% 100%',
        muted: '20 30% 80%', mutedForeground: '15 30% 33%',
        destructive: '0 75% 50%', border: '20 22% 70%', ring: '45 90% 52%',
    }, { subcategory: 'light' }),
    theme('black-ops', 'Black Ops', 'Pure OLED black with tactical orange, Black Ops series', '🎯', 'community', {
        background: '0 0% 0%', card: '0 0% 6%', cardForeground: '0 0% 98%',
        primary: '28 100% 46%', primaryForeground: '0 0% 0%',
        muted: '0 0% 3%', mutedForeground: '0 0% 58%',
        destructive: '0 70% 50%', border: '0 0% 14%',
    }, { subcategory: 'oled' }),
    theme('sonic', 'Sonicx161', 'The theme I used to develop 2.0', '⚡', 'community', {
        background: '30 25% 96%', card: '30 11% 100%', cardForeground: '30 11% 5%',
        primary: '30 70% 45%', muted: '30 14% 93%', mutedForeground: '30 11% 60%',
        destructive: '0 63% 40%', border: '30 14% 85%', ring: '30 70% 45%',
    }, { italic: true }),
    theme('pikachu', 'Pikachu', 'Electric sunshine, bright yellow fur with red cheeks and brown stripes', '🐭', 'community', {
        background: '48 55% 86%', card: '48 40% 94%', cardForeground: '35 70% 14%',
        primary: '40 90% 45%', primaryForeground: '0 0% 100%',
        muted: '48 30% 80%', mutedForeground: '35 35% 33%',
        destructive: '0 75% 50%', border: '48 25% 72%', ring: '0 80% 52%',
    }, { subcategory: 'light' }),
    theme('modern-warfare', 'Modern Warfare', 'Tactical military green and gold, Modern Warfare series', '🎖️', 'community', {
        background: '75 22% 6%', card: '75 18% 12%', cardForeground: '42 40% 92%',
        primary: '42 45% 56%', primaryForeground: '75 22% 5%',
        muted: '75 15% 9%', mutedForeground: '42 25% 55%',
        destructive: '0 60% 45%', border: '75 15% 19%',
    }, { subcategory: 'dark' }),
    theme('pokemon', 'Pokemon', 'Gotta catch em all, vibrant logo gold on deep adventure blue with Pokeball red', '⚡', 'community', {
        background: '220 55% 8%', card: '220 45% 15%', cardForeground: '48 100% 93%',
        primary: '48 100% 55%', primaryForeground: '220 55% 5%',
        muted: '220 30% 11%', mutedForeground: '48 50% 62%',
        destructive: '0 75% 55%', border: '220 30% 20%', ring: '355 85% 55%',
    }, { subcategory: 'dark' }),
    theme('cyberpunk-2077', 'Cyberpunk 2077', 'Yellow and cyan neon on near-black navy, straight from Night City', '🏙️', 'community', {
        background: '213 100% 4%', card: '213 60% 9%', cardForeground: '200 50% 95%',
        primary: '55 99% 50%', primaryForeground: '213 100% 4%',
        muted: '213 50% 7%', mutedForeground: '200 30% 55%',
        destructive: '0 70% 50%', border: '213 50% 14%', ring: '197 75% 62%',
    }, { subcategory: 'dark' }),
    theme('minecraft', 'Minecraft', 'Blocky grass green and dirt brown, infinite creative sandbox', '⛏️', 'community', {
        background: '95 20% 7%', card: '30 30% 12%', cardForeground: '95 40% 94%',
        primary: '95 65% 45%', primaryForeground: '95 20% 5%',
        muted: '30 20% 9%', mutedForeground: '95 35% 58%',
        destructive: '0 70% 50%', border: '95 25% 19%', ring: '30 40% 35%',
    }, { subcategory: 'dark' }),
    theme('bulbasaur', 'Bulbasaur', 'Grass Poison type, vibrant botanical garden greens with purple bloom', '🌱', 'community', {
        background: '100 38% 84%', card: '100 28% 92%', cardForeground: '100 40% 13%',
        primary: '95 55% 38%', primaryForeground: '0 0% 100%',
        muted: '100 22% 78%', mutedForeground: '100 20% 30%',
        destructive: '0 72% 45%', border: '100 18% 68%', ring: '280 45% 52%',
    }, { subcategory: 'light' }),
    theme('squirtle', 'Squirtle', 'Water type, bright bubbly ocean blue with warm brown shell accents', '🐢', 'community', {
        background: '200 48% 86%', card: '200 35% 94%', cardForeground: '210 50% 13%',
        primary: '205 70% 42%', primaryForeground: '0 0% 100%',
        muted: '200 28% 80%', mutedForeground: '210 25% 32%',
        destructive: '0 72% 45%', border: '200 22% 70%', ring: '30 45% 38%',
    }, { subcategory: 'light' }),
    theme('amd', 'AMD', 'Radeon red on dark, processor power', '🔴', 'community', {
        background: '0 0% 5%', card: '0 30% 11%', cardForeground: '0 0% 97%',
        primary: '0 82% 50%', primaryForeground: '0 0% 0%',
        muted: '0 20% 8%', mutedForeground: '0 15% 55%',
        destructive: '0 85% 55%', border: '0 20% 17%',
    }, { subcategory: 'dark' }),
    theme('realstream', 'RealStream', 'Keep it real, bold OLED black with pure white accents', '📡', 'community', {
        background: '0 0% 0%', card: '0 0% 6%', cardForeground: '0 0% 98%',
        primary: '0 0% 100%', primaryForeground: '0 0% 0%',
        muted: '0 0% 3%', mutedForeground: '0 0% 58%',
        destructive: '0 70% 50%', border: '0 0% 14%',
    }, { subcategory: 'oled' }),
    theme('aiostreams', 'AIOStreams', 'Pure Monochrome', '📡', 'community', {
        background: '0 0% 5%', card: '0 0% 16%', cardForeground: '0 0% 98%',
        primary: '0 0% 100%', muted: '0 0% 7%', mutedForeground: '0 0% 60%',
        destructive: '0 60% 40%', border: '0 0% 20%',
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
    theme('nvidia', 'Nvidia', 'Neon green on void black, GPU powerhouse', '📗', 'community', {
        background: '0 0% 0%', card: '0 0% 6%', cardForeground: '0 0% 98%',
        primary: '88 100% 47%', primaryForeground: '0 0% 0%',
        muted: '0 0% 3%', mutedForeground: '0 0% 58%',
        destructive: '0 70% 50%', border: '0 0% 14%',
    }, { subcategory: 'oled' }),
    theme('elfhosted', 'ElfHosted', 'Open source stream hosting', '🧝', 'community', {
        background: '96 40% 10%', card: '96 35% 18%', cardForeground: '96 30% 98%',
        primary: '96 58% 38%', muted: '96 25% 13%', mutedForeground: '96 20% 70%',
        destructive: '0 60% 40%', border: '96 25% 29%',
    }),
    theme('torbox', 'TorBox', 'Digital green cloud', '📦', 'community', {
        background: '185 30% 6%', card: '185 25% 17%', cardForeground: '160 30% 98%',
        primary: '161 56% 40%', muted: '185 20% 10%', mutedForeground: '160 20% 70%',
        destructive: '0 60% 40%', border: '185 20% 24%',
    }),
    theme('comet', 'Comet', 'Cosmic speed teal', '☄️', 'community', {
        background: '220 30% 6%', card: '220 25% 18%', cardForeground: '220 15% 98%',
        primary: '165 80% 60%', muted: '220 20% 8%', mutedForeground: '220 20% 60%',
        destructive: '0 60% 40%', border: '220 20% 21%', ring: '210 100% 64%',
    }),
    theme('real-debrid', 'Real-Debrid', 'Sky blue connect', '🍋', 'community', {
        background: '205 30% 10%', card: '205 25% 19%', cardForeground: '200 30% 98%',
        primary: '202 70% 78%', muted: '205 20% 14%', mutedForeground: '205 15% 70%',
        destructive: '0 63% 31%', border: '205 20% 29%',
    }),
    theme('steam', 'Steam', 'PC gaming hub, dark blue storefront with community accents', '🎮', 'community', {
        background: '215 30% 7%', card: '215 25% 13%', cardForeground: '210 20% 95%',
        primary: '205 70% 60%', primaryForeground: '215 30% 5%',
        muted: '215 20% 10%', mutedForeground: '210 15% 55%',
        destructive: '0 70% 50%', border: '215 20% 19%',
    }, { subcategory: 'dark' }),
    theme('nuvio', 'Nuvio', 'Library companion, blue teal and purple play button gradient on dark', '▶️', 'community', {
        background: '245 35% 7%', card: '240 30% 13%', cardForeground: '200 30% 95%',
        primary: '210 71% 52%', primaryForeground: '245 35% 5%',
        muted: '250 25% 10%', mutedForeground: '280 40% 62%',
        destructive: '0 63% 45%', border: '245 25% 19%', ring: '190 65% 53%',
    }, { subcategory: 'dark' }),
    theme('simkl', 'Simkl', 'Tracker deep blue', '🟦', 'community', {
        background: '0 0% 6%', card: '0 0% 18%', cardForeground: '225 30% 98%',
        primary: '220 80% 60%', muted: '0 0% 11%', mutedForeground: '225 15% 70%',
        destructive: '0 60% 40%', border: '0 0% 25%',
    }),
    theme('fusion', 'Fusion', 'Apple-elegant content manager, clean and minimalist', '⬡', 'community', {
        background: '220 20% 95%', card: '0 0% 100%', cardForeground: '220 25% 12%',
        primary: '220 60% 45%', primaryForeground: '0 0% 100%',
        muted: '220 15% 92%', mutedForeground: '220 12% 40%',
        destructive: '0 72% 45%', border: '220 15% 80%',
    }, { subcategory: 'light' }),
    theme('stremio', 'Stremio', 'Authorized community purple', '🟣', 'community', {
        background: '258 46% 12%', card: '258 43% 25%', cardForeground: '258 30% 98%',
        primary: '262 53% 62%', muted: '258 35% 17%', mutedForeground: '258 40% 75%',
        destructive: '0 63% 31%', border: '258 30% 30%',
    }),
    theme('trakt', 'Trakt', 'Scrobbler Red', '✔', 'community', {
        background: '0 0% 8%', card: '0 0% 19%', cardForeground: '0 0% 98%',
        primary: '355 85% 55%', muted: '0 0% 12%', mutedForeground: '0 0% 70%',
        destructive: '0 63% 31%', border: '0 0% 26%',
    }),
    theme('tamtaro', 'TamTaro', 'Tam the SEL man, warm orange aesthetic with custom logo', '🐹', 'community', {
        background: '15 10% 11%', card: '15 15% 16%', cardForeground: '15 20% 90%',
        primary: '27 87% 67%', muted: '16 20% 14%', mutedForeground: '15 15% 65%',
        destructive: '0 63% 40%', border: '15 10% 21%', ring: '27 87% 67%',
    }, { subcategory: 'dark', logoUrl: 'https://raw.githubusercontent.com/Tam-Taro/SEL-Filtering-and-Sorting/refs/heads/main/logo/aioman.png' }),
]

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
