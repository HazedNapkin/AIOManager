import { useCallback, useEffect, useState, type SyntheticEvent } from 'react'
import { createPortal } from 'react-dom'
import { Search } from 'lucide-react'
import type { ThemePalette } from '@/data/themes'
import { themeVariables } from '@/lib/theme-styles'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { Progress } from '@/components/ui/progress'
import { BrandLogo } from '@/components/common/BrandLogo'

const PREVIEW_DOCUMENT = '<!doctype html><html lang="en"><head><title>Theme sample</title></head><body></body></html>'

const SAMPLE_ADDONS = [
    { icon: '📡', name: 'AIOStreams', description: 'Streams · Movies & series', status: 'Active' },
    { icon: '🧠', name: 'AIOMetadata', description: 'Catalogs · Metadata', status: 'Active' },
    { icon: '🎬', name: 'Cinemeta', description: 'Catalogs · Movies & series', status: 'Update' },
    { icon: '💬', name: 'OpenSubtitles', description: 'Subtitles · Multi-language', status: 'Off' },
]

export function ThemeLivePreview({ palette, customCss, logoUrl }: { palette: ThemePalette; customCss: string; logoUrl?: string }) {
    const [previewRoot, setPreviewRoot] = useState<HTMLDivElement | null>(null)
    const [sampleSyncing, setSampleSyncing] = useState(false)

    const initializePreview = useCallback((event: SyntheticEvent<HTMLIFrameElement>) => {
        const doc = event.currentTarget.contentDocument
        if (!doc) return

        // Copy the real app stylesheet in development and production. The active
        // theme's global CSS must not leak into a different theme being edited.
        for (const source of document.querySelectorAll('style, link[rel="stylesheet"]')) {
            if (source.id !== 'aioman-custom-theme-css') {
                doc.head.appendChild(source.cloneNode(true))
            }
        }
        const baseStyle = doc.createElement('style')
        baseStyle.textContent = 'html { scrollbar-gutter: auto; } body { margin: 0; min-height: 0; background: hsl(var(--background)); color: hsl(var(--foreground)); }'
        doc.head.appendChild(baseStyle)
        const customStyle = doc.createElement('style')
        customStyle.id = 'aioman-custom-theme-css'
        doc.head.appendChild(customStyle)
        const root = doc.createElement('div')
        root.id = 'root'
        doc.body.replaceChildren(root)
        doc.documentElement.dataset.theme = 'custom-preview'
        setPreviewRoot(root)
    }, [])

    useEffect(() => {
        if (!previewRoot) return
        const doc = previewRoot.ownerDocument
        for (const [key, value] of Object.entries(themeVariables(palette))) {
            doc.documentElement.style.setProperty(key, value)
        }
        const style = doc.getElementById('aioman-custom-theme-css')
        // textContent matches live application and cannot close the style tag.
        if (style) style.textContent = customCss
    }, [previewRoot, palette, customCss])

    return (
        <>
            <iframe
                title="Live theme preview"
                className="block w-full h-[420px] rounded-xl border border-border/30 bg-background"
                sandbox="allow-same-origin"
                referrerPolicy="no-referrer"
                srcDoc={PREVIEW_DOCUMENT}
                onLoad={initializePreview}
            />
            {previewRoot && createPortal(
                <div data-theme-part="app-shell" className="min-h-[420px] bg-background text-foreground pb-3">
                    <header data-theme-part="app-header" data-sync-state={sampleSyncing ? 'syncing' : 'synced'} className="flex items-center gap-3 border-b border-border/40 bg-card px-3 py-3">
                        <BrandLogo logoUrl={logoUrl} label="" className="h-5 w-5" />
                        <span className="text-xs font-bold shrink-0">AIOManager</span>
                        <div className="relative ml-auto min-w-0 max-w-48">
                            <Search className="pointer-events-none absolute left-2 top-2 h-3 w-3 text-muted-foreground" />
                            <Input aria-label="Search sample addons" placeholder="Search addons..." className="h-7 pl-7 text-[10px]" />
                        </div>
                    </header>
                    <nav aria-label="Sample navigation" className="flex justify-center px-2 py-3">
                        <div data-theme-part="app-nav" className="flex flex-wrap gap-1 rounded-xl border border-border/40 bg-card p-1">
                            {['Accounts', 'Addons', 'Activity', 'Settings'].map(label => (
                                <a key={label} href="#" onClick={event => event.preventDefault()} data-theme-part="nav-item" data-state={label === 'Addons' ? 'active' : 'inactive'} aria-current={label === 'Addons' ? 'page' : undefined} className="inline-flex h-7 items-center rounded-lg px-2 text-[11px]">
                                    {label}
                                </a>
                            ))}
                        </div>
                    </nav>
                    <main className="px-3 space-y-2">
                        <div className="flex items-center gap-2 pb-1">
                            <h2 className="text-sm font-semibold">Installed addons</h2>
                            <Badge variant="secondary" className="px-1.5 text-[10px]">{SAMPLE_ADDONS.length}</Badge>
                            <Button size="sm" className="ml-auto h-7 px-2 text-[11px]" ripple={false}>Install addon</Button>
                        </div>
                        {SAMPLE_ADDONS.map(addon => (
                            <Card key={addon.name} data-theme-part="addon-card" className="flex items-center gap-2.5 px-3 py-2">
                                <span className="text-lg" aria-hidden="true">{addon.icon}</span>
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-xs font-semibold">{addon.name}</p>
                                    <p className="truncate text-[10px] text-muted-foreground">{addon.description}</p>
                                </div>
                                <Badge variant="outline" className="px-1.5 text-[10px]">{addon.status}</Badge>
                            </Card>
                        ))}
                        <details className="pt-1 text-xs text-muted-foreground">
                            <summary className="cursor-pointer py-1">More controls</summary>
                            <Card className="grid gap-2 mt-2 p-3">
                                <select aria-label="Sample addon category" data-theme-part="select-trigger" className="h-9 rounded-xl border border-border/40 bg-muted/30 px-3 text-foreground">
                                    <option>All addon types</option>
                                    <option>Streams</option>
                                    <option>Catalogs</option>
                                </select>
                                <Textarea aria-label="Sample note" placeholder="A note about this setup..." className="text-xs" />
                                <label className="flex items-center justify-between gap-2 text-foreground">
                                    Simulate syncing
                                    <Switch checked={sampleSyncing} onCheckedChange={setSampleSyncing} aria-label="Simulate syncing" />
                                </label>
                                <label className="flex items-center gap-2 text-foreground">
                                    <Checkbox checked={sampleSyncing} onCheckedChange={checked => setSampleSyncing(checked === true)} aria-label="Sample selection" />
                                    Selected state
                                </label>
                                <Progress value={sampleSyncing ? 65 : 100} aria-label="Sample sync progress" className="h-2" />
                            </Card>
                        </details>
                    </main>
                </div>,
                previewRoot,
            )}
        </>
    )
}
