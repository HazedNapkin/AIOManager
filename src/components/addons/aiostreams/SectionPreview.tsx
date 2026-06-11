import React from 'react'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'

interface SectionPreviewProps {
    data: unknown
    label: string
    children: React.ReactNode
}

const SECRET_KEY_PATTERN = /(api[-_ ]?key|access[-_ ]?token|token|password|secret|credential|encryptedpassword)/i

function redactPreviewData(data: unknown, key = ''): unknown {
    if (data == null) return data
    if (SECRET_KEY_PATTERN.test(key)) return '[hidden]'
    if (Array.isArray(data)) return data.map(item => redactPreviewData(item))
    if (typeof data === 'object') {
        return Object.entries(data as Record<string, unknown>).reduce<Record<string, unknown>>((acc, [entryKey, value]) => {
            acc[entryKey] = redactPreviewData(value, entryKey)
            return acc
        }, {})
    }
    return data
}

function renderPreviewContent(data: unknown): React.ReactNode {
    if (data == null) {
        return <p className="text-xs text-muted-foreground italic">Not configured</p>
    }

    const previewData = redactPreviewData(data)

    if (Array.isArray(previewData)) {
        if (previewData.length === 0) {
            return <p className="text-xs text-muted-foreground italic">Empty</p>
        }
        return (
            <div className="space-y-1.5">
                <p className="text-xs font-bold">{previewData.length} item{previewData.length !== 1 ? 's' : ''}</p>
                <div className="space-y-0.5 bg-muted/30 rounded-lg p-2">
                    {previewData.slice(0, 5).map((item, i) => (
                        <p key={i} className="text-xs font-mono text-foreground/70 truncate">
                            {typeof item === 'object' && item !== null
                                ? JSON.stringify(item).slice(0, 60)
                                : String(item).slice(0, 60)}
                        </p>
                    ))}
                    {previewData.length > 5 && (
                        <p className="text-xs text-muted-foreground">+{previewData.length - 5} more</p>
                    )}
                </div>
            </div>
        )
    }

    if (typeof previewData === 'object') {
        const entries = Object.entries(previewData as Record<string, unknown>)
        if (entries.length === 0) {
            return <p className="text-xs text-muted-foreground italic">Empty</p>
        }
        return (
            <div className="space-y-1.5">
                <p className="text-xs font-bold">{entries.length} propert{entries.length !== 1 ? 'ies' : 'y'}</p>
                <ScrollArea className="max-h-32">
                    <pre className="text-xs font-mono text-foreground/70 whitespace-pre-wrap break-all leading-relaxed bg-muted/30 rounded-lg p-2">
                        {JSON.stringify(previewData, null, 1).slice(0, 500)}
                        {JSON.stringify(previewData).length > 500 ? '\n…' : ''}
                    </pre>
                </ScrollArea>
            </div>
        )
    }

    return <p className="text-xs font-mono text-foreground/70">{String(previewData)}</p>
}

export function SectionPreview({ data, label, children }: SectionPreviewProps) {
    return (
        <Popover>
            <PopoverTrigger asChild>
                {children}
            </PopoverTrigger>
            <PopoverContent
                side="top"
                align="center"
                sideOffset={6}
                className="w-64 rounded-xl border border-border/40 shadow-lg p-3"
            >
                <p className="text-xs font-medium text-muted-foreground uppercase mb-1.5">{label}</p>
                {renderPreviewContent(data)}
            </PopoverContent>
        </Popover>
    )
}
