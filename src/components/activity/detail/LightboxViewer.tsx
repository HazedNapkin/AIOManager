import { ChevronLeft, ChevronRight, ZoomIn, X, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface LightboxViewerProps {
    images: string[]
    index: number | null
    zoom: boolean
    onClose: () => void
    onNavigate: (index: number) => void
    onToggleZoom: () => void
}

export function LightboxViewer({ images, index, zoom, onClose, onNavigate, onToggleZoom }: LightboxViewerProps) {
    if (index === null) return null
    const src = images[index]
    if (!src) return null

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm"
            onClick={onClose}
            onKeyDown={(e) => {
                if (e.key === 'Escape') onClose()
                if (e.key === 'ArrowLeft' && index > 0) onNavigate(index - 1)
                if (e.key === 'ArrowRight' && index < images.length - 1) onNavigate(index + 1)
            }}
            tabIndex={-1}
            autoFocus
        >
            <img
                src={src}
                alt=""
                className={cn(
                    'rounded-lg object-contain shadow-2xl transition-transform duration-200 cursor-pointer',
                    zoom ? 'max-h-[100vh] max-w-[100vw] scale-150' : 'max-h-[90vh] max-w-[95vw]'
                )}
                onClick={(e) => { e.stopPropagation(); onToggleZoom() }}
                draggable={false}
            />
            {index > 0 && (
                <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onNavigate(index - 1) }}
                    className="absolute left-4 top-1/2 -translate-y-1/2 flex h-12 w-12 items-center justify-center rounded-full border border-white/20 bg-black/60 text-white shadow-lg backdrop-blur-md transition-all hover:bg-black/80 hover:scale-110"
                    aria-label="Previous image"
                >
                    <ChevronLeft className="h-6 w-6" />
                </button>
            )}
            {index < images.length - 1 && (
                <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onNavigate(index + 1) }}
                    className="absolute right-4 top-1/2 -translate-y-1/2 flex h-12 w-12 items-center justify-center rounded-full border border-white/20 bg-black/60 text-white shadow-lg backdrop-blur-md transition-all hover:bg-black/80 hover:scale-110"
                    aria-label="Next image"
                >
                    <ChevronRight className="h-6 w-6" />
                </button>
            )}
            <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onToggleZoom() }}
                className="absolute bottom-4 left-4 flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/60 text-white shadow-lg backdrop-blur-md transition-all hover:bg-black/80 hover:scale-110"
                aria-label={zoom ? 'Zoom out' : 'Zoom in'}
            >
                <ZoomIn className="h-5 w-5" />
            </button>
            <span className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white backdrop-blur-md">
                {index + 1} / {images.length}
            </span>
            <button
                type="button"
                onClick={onClose}
                className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/60 text-white shadow-lg backdrop-blur-md transition-all hover:bg-black/80 hover:scale-110"
                aria-label="Close"
            >
                <X className="h-5 w-5" />
            </button>
            <a
                href={src}
                download
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="absolute bottom-4 right-4 flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/60 text-white shadow-lg backdrop-blur-md transition-all hover:bg-black/80 hover:scale-110"
                aria-label="Open original"
            >
                <ExternalLink className="h-5 w-5" />
            </a>
        </div>
    )
}
