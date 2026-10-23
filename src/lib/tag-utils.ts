export const TAG_PALETTE = [
    { bg: 'rgba(99,102,241,0.2)', text: 'color-mix(in srgb, #a5b4fc var(--tag-color-strength, 100%), hsl(var(--card-foreground)))', border: 'rgba(99,102,241,0.3)' },
    { bg: 'rgba(8,145,178,0.2)', text: 'color-mix(in srgb, #67e8f9 var(--tag-color-strength, 100%), hsl(var(--card-foreground)))', border: 'rgba(8,145,178,0.3)' },
    { bg: 'rgba(5,150,105,0.2)', text: 'color-mix(in srgb, #6ee7b7 var(--tag-color-strength, 100%), hsl(var(--card-foreground)))', border: 'rgba(5,150,105,0.3)' },
    { bg: 'rgba(217,119,6,0.2)', text: 'color-mix(in srgb, #fcd34d var(--tag-color-strength, 100%), hsl(var(--card-foreground)))', border: 'rgba(217,119,6,0.3)' },
    { bg: 'rgba(220,38,38,0.2)', text: 'color-mix(in srgb, #fca5a5 var(--tag-color-strength, 100%), hsl(var(--card-foreground)))', border: 'rgba(220,38,38,0.3)' },
    { bg: 'rgba(124,58,237,0.2)', text: 'color-mix(in srgb, #c4b5fd var(--tag-color-strength, 100%), hsl(var(--card-foreground)))', border: 'rgba(124,58,237,0.3)' },
    { bg: 'rgba(219,39,119,0.2)', text: 'color-mix(in srgb, #f9a8d4 var(--tag-color-strength, 100%), hsl(var(--card-foreground)))', border: 'rgba(219,39,119,0.3)' },
    { bg: 'hsl(var(--muted))', text: 'hsl(var(--muted-foreground))', border: 'transparent' },
]

export function getTagColor(tag: string) {
    let hash = 0
    for (let i = 0; i < tag.length; i++) hash = tag.charCodeAt(i) + ((hash << 5) - hash)
    return TAG_PALETTE[Math.abs(hash) % TAG_PALETTE.length]
}
