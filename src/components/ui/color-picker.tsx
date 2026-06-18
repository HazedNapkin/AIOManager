import { useCallback, useRef, useState, useEffect, memo } from 'react'

function hsvToHex(h: number, s: number, v: number): string {
    s /= 100; v /= 100
    const c = v * s
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
    const m = v - c
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

function hexToHsv(hex: string): { h: number; s: number; v: number } | null {
    const match = hex.match(/^#?([0-9a-f]{6})$/i)
    if (!match) return null
    const r = parseInt(match[1].slice(0, 2), 16) / 255
    const g = parseInt(match[1].slice(2, 4), 16) / 255
    const b = parseInt(match[1].slice(4, 6), 16) / 255
    const max = Math.max(r, g, b), min = Math.min(r, g, b)
    const d = max - min
    const v = max
    const s = max === 0 ? 0 : d / max
    let h = 0
    if (d !== 0) {
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0))
        else if (max === g) h = ((b - r) / d + 2)
        else h = ((r - g) / d + 4)
        h *= 60
    }
    return { h: Math.round(h), s: Math.round(s * 100), v: Math.round(v * 100) }
}

function getXY(e: React.MouseEvent | React.TouchEvent | MouseEvent | Touch | globalThis.TouchEvent): { x: number; y: number } {
    if ('touches' in e) {
        const t = (e as globalThis.TouchEvent).touches[0] || (e as globalThis.TouchEvent).changedTouches[0]
        return t ? { x: t.clientX, y: t.clientY } : { x: 0, y: 0 }
    }
    return { x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY }
}

const SVArea = memo(function SVArea({ hue, sat, val, onChange, onInteractionStart, onInteractionEnd }: {
    hue: number
    sat: number
    val: number
    onChange: (s: number, v: number) => void
    onInteractionStart?: () => void
    onInteractionEnd?: () => void
}) {
    const ref = useRef<HTMLDivElement>(null)
    const dragging = useRef(false)

    const pick = useCallback((e: React.MouseEvent | React.TouchEvent | MouseEvent | Touch | globalThis.TouchEvent) => {
        const el = ref.current
        if (!el) return
        const rect = el.getBoundingClientRect()
        const { x, y } = getXY(e)
        const sx = Math.max(0, Math.min(1, (x - rect.left) / rect.width))
        const sy = Math.max(0, Math.min(1, (y - rect.top) / rect.height))
        onChange(Math.round(sx * 100), Math.round((1 - sy) * 100))
    }, [onChange])

    const bind = useCallback((startE: React.MouseEvent | React.TouchEvent) => {
        startE.preventDefault()
        dragging.current = true
        onInteractionStart?.()
        pick(startE)
        const onMove = (ev: MouseEvent | globalThis.TouchEvent) => {
            if (!dragging.current) return
            if (ev.cancelable) ev.preventDefault()
            pick(ev)
        }
        const onUp = () => {
            dragging.current = false
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
            window.removeEventListener('touchmove', onMove)
            window.removeEventListener('touchend', onUp)
            window.removeEventListener('touchcancel', onUp)
            onInteractionEnd?.()
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
        window.addEventListener('touchmove', onMove, { passive: false })
        window.addEventListener('touchend', onUp)
        window.addEventListener('touchcancel', onUp)
    }, [onInteractionEnd, onInteractionStart, pick])

    const thumbBorder = val < 40 ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.95)'

    return (
        <div
            ref={ref}
            className="relative w-full aspect-[4/3] touch-none select-none rounded-2xl overflow-hidden cursor-crosshair shadow-inner"
            style={{
                background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hue}, 100%, 50%))`,
            }}
            onMouseDown={bind}
            onTouchStart={bind}
        >
            <div
                className="absolute pointer-events-none h-5 w-5 rounded-full transition-[width,height] duration-75"
                style={{
                    left: `${sat}%`,
                    top: `${100 - val}%`,
                    transform: 'translate(-50%, -50%)',
                    background: hsvToHex(hue, sat, val),
                    boxShadow: `inset 0 0 0 2.5px ${thumbBorder}, 0 0 0 1px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.2)`,
                }}
            />
        </div>
    )
})

const HueBar = memo(function HueBar({ hue, onChange, onInteractionStart, onInteractionEnd }: {
    hue: number
    onChange: (h: number) => void
    onInteractionStart?: () => void
    onInteractionEnd?: () => void
}) {
    const ref = useRef<HTMLDivElement>(null)
    const dragging = useRef(false)

    const pick = useCallback((e: React.MouseEvent | React.TouchEvent | MouseEvent | Touch | globalThis.TouchEvent) => {
        const el = ref.current
        if (!el) return
        const rect = el.getBoundingClientRect()
        const { x } = getXY(e)
        const ratio = Math.max(0, Math.min(1, (x - rect.left) / rect.width))
        onChange(Math.round(ratio * 360))
    }, [onChange])

    const bind = useCallback((startE: React.MouseEvent | React.TouchEvent) => {
        startE.preventDefault()
        dragging.current = true
        onInteractionStart?.()
        pick(startE)
        const onMove = (ev: MouseEvent | globalThis.TouchEvent) => {
            if (!dragging.current) return
            if (ev.cancelable) ev.preventDefault()
            pick(ev)
        }
        const onUp = () => {
            dragging.current = false
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
            window.removeEventListener('touchmove', onMove)
            window.removeEventListener('touchend', onUp)
            window.removeEventListener('touchcancel', onUp)
            onInteractionEnd?.()
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
        window.addEventListener('touchmove', onMove, { passive: false })
        window.addEventListener('touchend', onUp)
        window.addEventListener('touchcancel', onUp)
    }, [onInteractionEnd, onInteractionStart, pick])

    return (
        <div
            ref={ref}
            className="relative h-3.5 w-full touch-none select-none rounded-full cursor-pointer overflow-hidden"
            style={{
                background: 'linear-gradient(to right, hsl(0,100%,50%), hsl(60,100%,50%), hsl(120,100%,50%), hsl(180,100%,50%), hsl(240,100%,50%), hsl(300,100%,50%), hsl(360,100%,50%))',
            }}
            onMouseDown={bind}
            onTouchStart={bind}
        >
            <div
                className="absolute pointer-events-none top-0 h-full w-3.5 rounded-full"
                style={{
                    left: `${(hue / 360) * 100}%`,
                    transform: 'translateX(-50%)',
                    background: `hsl(${hue}, 100%, 50%)`,
                    boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.95), 0 0 0 1px rgba(0,0,0,0.1), 0 1px 4px rgba(0,0,0,0.15)',
                }}
            />
        </div>
    )
})

interface ColorPickerProps {
    value: string
    onChange: (hex: string) => void
    className?: string
}

export const ColorPicker = memo(function ColorPicker({ value, onChange, className }: ColorPickerProps) {
    const [draft, setDraft] = useState(value)
    const [hsv, setHsv] = useState(() => hexToHsv(value) ?? { h: 220, s: 70, v: 80 })
    const suppressExternalSyncRef = useRef(false)
    const suppressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const interactingRef = useRef(false)

    const releaseExternalSync = useCallback(() => {
        if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current)
        suppressTimerRef.current = setTimeout(() => {
            suppressExternalSyncRef.current = false
        }, 300)
    }, [])

    const beginInteraction = useCallback(() => {
        interactingRef.current = true
        suppressExternalSyncRef.current = true
        if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current)
    }, [])

    const endInteraction = useCallback(() => {
        interactingRef.current = false
        releaseExternalSync()
    }, [releaseExternalSync])

    const emitInternalChange = useCallback((next: { h: number; s: number; v: number }) => {
        const hex = hsvToHex(next.h, next.s, next.v)
        setHsv(next)
        setDraft(hex)
        suppressExternalSyncRef.current = true

        if (!interactingRef.current) releaseExternalSync()

        onChange(hex)
    }, [onChange, releaseExternalSync])

    useEffect(() => {
        if (suppressExternalSyncRef.current) return

        setDraft(value)

        const next = hexToHsv(value)
        if (next) setHsv(next)
    }, [value])

    useEffect(() => () => {
        if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current)
    }, [])

    const h = hsv.h
    const s = hsv.s
    const v = hsv.v
    const displayHex = hsvToHex(h, s, v)

    const handleSVChange = useCallback((newS: number, newV: number) => {
        emitInternalChange({ h, s: newS, v: newV })
    }, [emitInternalChange, h])

    const handleHueChange = useCallback((newH: number) => {
        emitInternalChange({ h: newH, s, v })
    }, [emitInternalChange, s, v])

    const applyHex = useCallback((val: string) => {
        const clean = val.startsWith('#') ? val : `#${val}`
        if (/^#[0-9a-f]{6}$/i.test(clean)) {
            const next = hexToHsv(clean)
            if (next) emitInternalChange(next)
        }
    }, [emitInternalChange])

    return (
        <div className={className ?? 'space-y-3'}>
            <SVArea hue={h} sat={s} val={v} onChange={handleSVChange} onInteractionStart={beginInteraction} onInteractionEnd={endInteraction} />
            <HueBar hue={h} onChange={handleHueChange} onInteractionStart={beginInteraction} onInteractionEnd={endInteraction} />
            <div className="flex min-w-0 items-center gap-2.5 px-3 py-2 rounded-xl border border-border/20 bg-muted/10 group hover:border-primary/30 focus-within:border-primary/30 focus-within:ring-1 focus-within:ring-primary/30 transition-colors">
                <div className="w-5 h-5 rounded-lg shadow-sm shrink-0 ring-1 ring-black/5" style={{ background: displayHex }} />
                <input
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onBlur={() => applyHex(draft)}
                    onKeyDown={e => { if (e.key === 'Enter') applyHex(draft) }}
                    placeholder="#000000"
                    maxLength={7}
                    spellCheck={false}
                    className="min-w-0 flex-1 font-mono text-xs bg-transparent focus-visible:outline-none text-foreground placeholder:text-muted-foreground/40"
                />
            </div>
        </div>
    )
})
