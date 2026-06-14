import { triggerSync } from '@/lib/sync-trigger'
import { useEffect, useRef, useState, useMemo } from 'react'
import { NoteMeta } from '@/store/notesStore'
import { ZoomIn, ZoomOut, Maximize, Minimize, Settings2, Target, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SYNCED_SETTINGS_EVENT, type NotesGraphSettings } from '@/lib/synced-settings'

interface NotesGraphProps {
    notes: NoteMeta[]
    onNodeClick: (id: string) => void
}

interface GraphNode {
    id: string
    title: string
    x: number
    y: number
    vx: number
    vy: number
    radius: number
    isTag?: boolean
    primaryTag?: string
}

interface GraphLink {
    source: GraphNode
    target: GraphNode
}

function getThemeColor(varName: string, fallback: string): string {
    if (typeof document === 'undefined') return fallback
    const val = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
    if (!val) return fallback
    if (val.startsWith('#') || val.startsWith('rgba') || val.startsWith('rgb')) return val
    return `hsl(${val})`
}

const TAG_COLORS = [
    '#10b981', // emerald
    '#f59e0b', // amber
    '#ef4444', // red
    '#3b82f6', // blue
    '#ec4899', // pink
    '#14b8a6', // teal
    '#f97316', // orange
]

function getTagColor(tag: string | undefined): string {
    if (!tag) return '#3b82f6'
    let hash = 0
    for (let i = 0; i < tag.length; i++) hash = tag.charCodeAt(i) + ((hash << 5) - hash)
    return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length]
}

export function NotesGraph({ notes, onNodeClick }: NotesGraphProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [isDragging, setIsDragging] = useState(false)
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
    const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null)
    
    // Persistent settings
    const [linkDistance, setLinkDistance] = useState(() => Number(localStorage.getItem('notes-graph-linkDist')) || 150)
    const [repelStrength, setRepelStrength] = useState(() => Number(localStorage.getItem('notes-graph-repel')) || 5000)
    const [centerGravity, setCenterGravity] = useState(() => {
        const saved = localStorage.getItem('notes-graph-gravity')
        return saved !== null ? Number(saved) : 0.01
    })
    const [rotation, setRotation] = useState(() => {
        const saved = localStorage.getItem('notes-graph-rotation')
        return saved !== null ? Number(saved) : 0
    })
    const [showTags, setShowTags] = useState(() => localStorage.getItem('notes-graph-tags') === 'true')
    const [showOrphans, setShowOrphans] = useState(() => {
        const saved = localStorage.getItem('notes-graph-orphans')
        return saved === null || saved === 'true'
    })
    const [nodeScale, setNodeScale] = useState(() => Number(localStorage.getItem('notes-graph-nodeScale')) || 1)
    const [transform, setTransform] = useState<{ x: number; y: number; scale: number }>(() => {
        try {
            const saved = localStorage.getItem('notes-graph-transform')
            return saved ? JSON.parse(saved) : { x: 0, y: 0, scale: 1 }
        } catch {
            return { x: 0, y: 0, scale: 1 }
        }
    })
    
    const [isFullscreen, setIsFullscreen] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')

    const didMountSettingsRef = useRef(false)
    const applyingSyncedSettingsRef = useRef(false)
    const settingsSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const queueSettingsSync = () => {
        if (settingsSyncTimerRef.current) clearTimeout(settingsSyncTimerRef.current)
        settingsSyncTimerRef.current = setTimeout(() => {
            settingsSyncTimerRef.current = null
            triggerSync()
        }, 800)
    }

    useEffect(() => {
        return () => {
            if (settingsSyncTimerRef.current) clearTimeout(settingsSyncTimerRef.current)
        }
    }, [])

    useEffect(() => {
        const handleSyncedSettings = (event: Event) => {
            const notesGraph = (event as CustomEvent<{ notesGraph?: NotesGraphSettings }>).detail?.notesGraph
            if (!notesGraph) return
            applyingSyncedSettingsRef.current = true
            if (typeof notesGraph.linkDistance === 'number') setLinkDistance(notesGraph.linkDistance)
            if (typeof notesGraph.repelStrength === 'number') setRepelStrength(notesGraph.repelStrength)
            if (typeof notesGraph.centerGravity === 'number') setCenterGravity(notesGraph.centerGravity)
            if (typeof notesGraph.rotation === 'number') setRotation(notesGraph.rotation)
            if (typeof notesGraph.showTags === 'boolean') setShowTags(notesGraph.showTags)
            if (typeof notesGraph.showOrphans === 'boolean') setShowOrphans(notesGraph.showOrphans)
            if (typeof notesGraph.nodeScale === 'number') setNodeScale(notesGraph.nodeScale)
            if (notesGraph.transform) setTransform(notesGraph.transform)
        }

        window.addEventListener(SYNCED_SETTINGS_EVENT, handleSyncedSettings)
        return () => window.removeEventListener(SYNCED_SETTINGS_EVENT, handleSyncedSettings)
    }, [])

    useEffect(() => {
        if (!didMountSettingsRef.current) {
            didMountSettingsRef.current = true
            return
        }

        localStorage.setItem('notes-graph-linkDist', String(linkDistance))
        localStorage.setItem('notes-graph-repel', String(repelStrength))
        localStorage.setItem('notes-graph-gravity', String(centerGravity))
        localStorage.setItem('notes-graph-tags', String(showTags))
        localStorage.setItem('notes-graph-orphans', String(showOrphans))
        localStorage.setItem('notes-graph-nodeScale', String(nodeScale))
        localStorage.setItem('notes-graph-rotation', String(rotation))
        localStorage.setItem('notes-graph-transform', JSON.stringify(transform))

        if (applyingSyncedSettingsRef.current) {
            applyingSyncedSettingsRef.current = false
            return
        }
        queueSettingsSync()
    }, [linkDistance, repelStrength, centerGravity, showTags, showOrphans, nodeScale, rotation, transform])

    useEffect(() => {
        const handler = () => setIsFullscreen(!!document.fullscreenElement)
        document.addEventListener('fullscreenchange', handler)
        return () => document.removeEventListener('fullscreenchange', handler)
    }, [])

    // Physics constants
    const SPRING_K = 0.05 
    const DAMPING = 0.85
    
    const { nodes, links } = useMemo(() => {
        let nodeList: GraphNode[] = notes.map(n => ({
            id: n.id,
            title: n.title === 'Untitled' ? 'Untitled Note' : n.title,
            x: Math.random() * 800 - 400,
            y: Math.random() * 800 - 400,
            vx: 0,
            vy: 0,
            radius: (8 + Math.min(n.wikilinks.length * 2 + n.tags.length, 12)) * nodeScale,
            isTag: false,
            primaryTag: n.tags.length > 0 ? n.tags[0] : undefined
        }))
        
        const nodeMap = new Map(nodeList.map(n => [n.id, n]))
        const titleMap = new Map(nodeList.map(n => [n.title.toLowerCase(), n]))
        const linkList: GraphLink[] = []
        const linkedNodeIds = new Set<string>()
        
        notes.forEach(note => {
            const source = nodeMap.get(note.id)
            if (!source) return
            note.wikilinks.forEach(title => {
                const target = titleMap.get(title.toLowerCase())
                if (target && target.id !== source.id) {
                    if (!linkList.some(l => (l.source.id === source.id && l.target.id === target.id) || (l.source.id === target.id && l.target.id === source.id))) {
                        linkList.push({ source, target })
                        linkedNodeIds.add(source.id)
                        linkedNodeIds.add(target.id)
                    }
                }
            })
        })

        if (showTags) {
            const tagNodes = new Map<string, GraphNode>()
            notes.forEach(note => {
                const source = nodeMap.get(note.id)
                if (!source) return
                note.tags.forEach(tag => {
                    const tagId = `tag-${tag}`
                    if (!tagNodes.has(tagId)) {
                        tagNodes.set(tagId, {
                            id: tagId, title: `#${tag}`,
                            x: Math.random() * 800 - 400, y: Math.random() * 800 - 400,
                            vx: 0, vy: 0, radius: 6 * nodeScale, isTag: true
                        })
                    }
                    const target = tagNodes.get(tagId)!
                    linkList.push({ source, target })
                    linkedNodeIds.add(source.id); linkedNodeIds.add(target.id)
                })
            })
            nodeList = [...nodeList, ...Array.from(tagNodes.values())]
        }

        if (!showOrphans) {
            nodeList = nodeList.filter(n => n.isTag || linkedNodeIds.has(n.id))
        }
        return { nodes: nodeList, links: linkList }
    }, [notes, showTags, showOrphans, nodeScale])

    useEffect(() => {
        const canvas = canvasRef.current; if (!canvas) return
        let animationFrameId: number
        
        const draw = () => {
            const ctx = canvas.getContext('2d'); if (!ctx) return
            
            // Physics
            if (centerGravity > 0) {
                nodes.forEach(n => {
                    n.vx += -n.x * centerGravity
                    n.vy += -n.y * centerGravity
                    if (rotation !== 0) {
                        const dist = Math.sqrt(n.x * n.x + n.y * n.y)
                        if (dist > 0) {
                            const force = rotation * 0.05
                            n.vx += (-n.y / dist) * force
                            n.vy += (n.x / dist) * force
                        }
                    }
                })
            }
            for (let i = 0; i < nodes.length; i++) {
                for (let j = i + 1; j < nodes.length; j++) {
                    const n1 = nodes[i], n2 = nodes[j]
                    const dx = n2.x - n1.x, dy = n2.y - n1.y
                    const distSq = dx * dx + dy * dy
                    if (distSq > 0) {
                        const dist = Math.sqrt(distSq)
                        const force = repelStrength / distSq
                        const fx = (dx / dist) * force, fy = (dy / dist) * force
                        n1.vx -= fx; n1.vy -= fy; n2.vx += fx; n2.vy += fy
                    }
                }
            }
            links.forEach(link => {
                const dx = link.target.x - link.source.x, dy = link.target.y - link.source.y
                const dist = Math.sqrt(dx * dx + dy * dy)
                if (dist > 0) {
                    const force = (dist - linkDistance) * SPRING_K
                    const fx = (dx / dist) * force, fy = (dy / dist) * force
                    link.source.vx += fx; link.source.vy += fy
                    link.target.vx -= fx; link.target.vy -= fy
                }
            })
            nodes.forEach(n => {
                n.vx *= DAMPING; n.vy *= DAMPING
                n.x += n.vx; n.y += n.vy
            })

            const width = canvas.width, height = canvas.height
            ctx.clearRect(0, 0, width, height)
            ctx.save()
            ctx.translate(width / 2 + transform.x, height / 2 + transform.y)
            ctx.scale(transform.scale, transform.scale)
            
            const searchLower = searchQuery.toLowerCase()
            const isSearching = searchLower.length > 0
            const matchingIds = new Set<string>()
            if (isSearching) {
                nodes.forEach(n => { if (n.title.toLowerCase().includes(searchLower)) matchingIds.add(n.id) })
                links.forEach(l => {
                    if (matchingIds.has(l.source.id)) matchingIds.add(l.target.id)
                    if (matchingIds.has(l.target.id)) matchingIds.add(l.source.id)
                })
            }

            const getAlpha = (id1: string, id2?: string) => {
                if (!isSearching) return 1
                return (matchingIds.has(id1) || (id2 && matchingIds.has(id2))) ? 1 : 0.15
            }

            ctx.lineWidth = 1.5
            links.forEach(link => {
                const alpha = getAlpha(link.source.id, link.target.id)
                ctx.strokeStyle = getThemeColor('--muted-foreground', 'rgba(150, 150, 150, 1)').replace('1)', `${alpha * 0.4})`).replace('rgb(', 'rgba(')
                ctx.beginPath(); ctx.moveTo(link.source.x, link.source.y); ctx.lineTo(link.target.x, link.target.y); ctx.stroke()
            })
            
            const showText = transform.scale > 0.6
            const primaryColor = getThemeColor('--primary', '#6366f1')
            const fgColor = getThemeColor('--foreground', '#ffffff')
            const mutedFg = getThemeColor('--muted-foreground', '#a1a1aa')
            const fgAlpha = fgColor.startsWith('#') ? fgColor + '33' : 'rgba(255,255,255,0.2)'
            nodes.forEach(n => {
                const isHovered = hoveredNodeId === n.id
                const isFocused = focusedNodeId === n.id
                const alpha = getAlpha(n.id)
                ctx.beginPath(); ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2)
                ctx.globalAlpha = alpha
                ctx.fillStyle = (isHovered || isFocused) ? primaryColor : n.isTag ? getThemeColor('--info', '#8b5cf6') : getTagColor(n.primaryTag)
                ctx.fill()
                ctx.strokeStyle = (isHovered || isFocused) ? fgColor : fgAlpha
                ctx.lineWidth = 1.5; ctx.stroke()
                if (showText || isHovered || isFocused || (isSearching && alpha === 1)) {
                    ctx.fillStyle = (isHovered || isFocused) ? fgColor : mutedFg
                    ctx.font = `${(isHovered || isFocused) ? 'bold ' : ''}12px Inter, sans-serif`
                    ctx.textAlign = 'center'
                    ctx.fillText(n.title, n.x, n.y + n.radius + 14)
                }
                ctx.globalAlpha = 1
            })
            ctx.restore()
            animationFrameId = requestAnimationFrame(draw)
        }
        draw()
        return () => cancelAnimationFrame(animationFrameId)
    }, [nodes, links, transform, hoveredNodeId, focusedNodeId, repelStrength, linkDistance, centerGravity, rotation, searchQuery])

    useEffect(() => {
        const resize = () => { if (canvasRef.current && containerRef.current) { canvasRef.current.width = containerRef.current.clientWidth; canvasRef.current.height = containerRef.current.clientHeight } }
        window.addEventListener('resize', resize); resize()
        return () => window.removeEventListener('resize', resize)
    }, [])
    
    const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
        setIsDragging(true)
        const pos = 'touches' in e ? e.touches[0] : e
        setDragStart({ x: pos.clientX - transform.x, y: pos.clientY - transform.y })
    }

    const handlePointerMove = (e: React.MouseEvent | React.TouchEvent) => {
        const pos = 'touches' in e ? e.touches[0] : e
        if (isDragging) {
            setTransform(prev => ({ ...prev, x: pos.clientX - dragStart.x, y: pos.clientY - dragStart.y }))
        } else {
            const canvas = canvasRef.current; if (!canvas) return
            const rect = canvas.getBoundingClientRect()
            const mX = (pos.clientX - rect.left - canvas.width / 2 - transform.x) / transform.scale
            const mY = (pos.clientY - rect.top - canvas.height / 2 - transform.y) / transform.scale
            let hovered = null
            for (let i = nodes.length - 1; i >= 0; i--) {
                const n = nodes[i]; const dx = mX - n.x, dy = mY - n.y
                if (dx * dx + dy * dy <= n.radius * n.radius + 25) { hovered = n.id; break }
            }
            setHoveredNodeId(hovered)
        }
    }

    const handleWheel = (e: React.WheelEvent) => {
        e.preventDefault()
        const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1
        setTransform(prev => ({ ...prev, scale: Math.min(Math.max(0.1, prev.scale * zoomDelta), 4) }))
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        const nonTagNodes = nodes.filter(n => !n.isTag)
        if (nonTagNodes.length === 0) return

        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            e.preventDefault()
            setFocusedNodeId(prev => {
                if (!prev) return nonTagNodes[0].id
                const idx = nonTagNodes.findIndex(n => n.id === prev)
                return nonTagNodes[(idx + 1) % nonTagNodes.length].id
            })
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault()
            setFocusedNodeId(prev => {
                if (!prev) return nonTagNodes[nonTagNodes.length - 1].id
                const idx = nonTagNodes.findIndex(n => n.id === prev)
                return nonTagNodes[(idx - 1 + nonTagNodes.length) % nonTagNodes.length].id
            })
        } else if (e.key === 'Enter' && focusedNodeId) {
            e.preventDefault()
            onNodeClick(focusedNodeId)
        }
    }

    return (
        <div ref={containerRef} className="w-full h-full relative overflow-hidden bg-background"
            onMouseDown={handlePointerDown} onMouseMove={handlePointerMove} onMouseUp={() => setIsDragging(false)} onMouseLeave={() => setIsDragging(false)}
            onTouchStart={handlePointerDown} onTouchMove={handlePointerMove} onTouchEnd={() => setIsDragging(false)}
            onClick={() => { if (hoveredNodeId && !isDragging && !hoveredNodeId.startsWith('tag-')) onNodeClick(hoveredNodeId) }} onWheel={handleWheel}>
            <canvas ref={canvasRef} role="img" aria-label={`Notes graph showing ${nodes.filter(n => !n.isTag).length} notes and ${links.length} connections. Use arrow keys to navigate nodes, Enter to select.`} tabIndex={0} onKeyDown={handleKeyDown} className={cn("block w-full h-full outline-none", hoveredNodeId || focusedNodeId ? 'cursor-pointer' : isDragging ? 'cursor-grabbing' : 'cursor-grab')} />
            <span className="sr-only">Interactive force-directed graph visualizing connections between notes. Nodes represent notes, lines represent wikilink connections. Tab to focus the graph, use arrow keys to move between note nodes, and press Enter to open a note.</span>
            <div className="absolute top-4 left-4 z-10 flex flex-col gap-2">
                <button onClick={() => setSettingsOpen(!settingsOpen)} className={cn("w-8 h-8 rounded-lg border flex items-center justify-center shadow-sm", settingsOpen ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border/40 text-muted-foreground hover:text-foreground")}>
                    <Settings2 className="w-4 h-4" />
                </button>
                {settingsOpen && (
                    <div className="w-64 bg-card border border-border/40 rounded-2xl p-4 shadow-2xl flex flex-col gap-5 animate-in fade-in zoom-in-95 duration-150">
                        <div className="flex items-center gap-2 mb-1">
                            <Settings2 className="w-3.5 h-3.5 text-primary" />
                            <span className="text-[13px] font-medium text-foreground/60">Graph Engine</span>
                        </div>
                        <div className="flex flex-col gap-2">
                            <label className="text-xs font-medium text-muted-foreground flex justify-between"><span>Link Distance</span><span>{linkDistance}</span></label>
                            <input type="range" min="30" max="300" value={linkDistance} onChange={e => setLinkDistance(Number(e.target.value))} className="accent-primary" />
                        </div>
                        <div className="flex flex-col gap-2">
                            <label className="text-xs font-medium text-muted-foreground flex justify-between"><span>Repel Strength</span><span>{repelStrength}</span></label>
                            <input type="range" min="1000" max="10000" step="500" value={repelStrength} onChange={e => setRepelStrength(Number(e.target.value))} className="accent-primary" />
                        </div>
                        <div className="flex flex-col gap-2">
                            <label className="text-xs font-medium text-muted-foreground flex justify-between"><span>Center Gravity</span><span>{centerGravity.toFixed(2)}</span></label>
                            <input type="range" min="0" max="0.1" step="0.01" value={centerGravity} onChange={e => setCenterGravity(Number(e.target.value))} className="accent-primary" />
                        </div>
                        <div className="flex flex-col gap-2">
                            <label className="text-xs font-medium text-muted-foreground flex justify-between"><span>Orbital Spin</span><span>{rotation.toFixed(2)}</span></label>
                            <input type="range" min="-0.5" max="0.5" step="0.05" value={rotation} onChange={e => setRotation(Number(e.target.value))} className="accent-primary" />
                        </div>
                        <div className="h-px bg-border/40 my-1" />
                        <label className="flex items-center gap-2.5 text-xs font-medium text-foreground cursor-pointer select-none">
                            <input type="checkbox" checked={showTags} onChange={e => setShowTags(e.target.checked)} className="accent-primary w-3.5 h-3.5 rounded" /> Show Tags
                        </label>
                        <label className="flex items-center gap-2.5 text-xs font-medium text-foreground cursor-pointer select-none">
                            <input type="checkbox" checked={showOrphans} onChange={e => setShowOrphans(e.target.checked)} className="accent-primary w-3.5 h-3.5 rounded" /> Show Orphans
                        </label>
                    </div>
                )}
            </div>
            <div className="absolute top-4 right-4 flex flex-col gap-2 z-10">
                <button onClick={() => setTransform(p => ({ ...p, scale: Math.min(p.scale * 1.2, 4) }))} className="w-8 h-8 rounded-lg bg-card border border-border/40 flex items-center justify-center text-muted-foreground hover:text-foreground shadow-sm"><ZoomIn className="w-4 h-4" /></button>
                <button onClick={() => setTransform(p => ({ ...p, scale: Math.max(p.scale * 0.8, 0.1) }))} className="w-8 h-8 rounded-lg bg-card border border-border/40 flex items-center justify-center text-muted-foreground hover:text-foreground shadow-sm"><ZoomOut className="w-4 h-4" /></button>
                <button onClick={() => setTransform({ x: 0, y: 0, scale: 1 })} className="w-8 h-8 rounded-lg bg-card border border-border/40 flex items-center justify-center text-muted-foreground hover:text-foreground shadow-sm"><Target className="w-4 h-4" /></button>
                <button onClick={() => { if (!isFullscreen) containerRef.current?.requestFullscreen(); else document.exitFullscreen() }} className="w-8 h-8 rounded-lg bg-card border border-border/40 flex items-center justify-center text-muted-foreground hover:text-foreground shadow-sm">
                    {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
                </button>
            </div>
            <div className="absolute bottom-4 left-4 z-10 w-64 group">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60" />
                <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Filter graph..." className="w-full bg-card border border-border/40 rounded-lg pl-8 pr-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-primary/50" />
            </div>
        </div>
    )
}
