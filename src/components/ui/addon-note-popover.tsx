import { useState, useRef, useEffect, useCallback } from 'react'
import { Tooltip } from '@/components/ui/tooltip'
import { AddonIcon } from '@/components/ui/addon-icon'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { StickyNote, Undo2, Redo2, Trash2, List, ListOrdered, Bold, Italic, Link, Check, Pencil } from 'lucide-react'
import { cn, inlineFormat } from '@/lib/utils'
import { STICKY_NOTE_MAX_LENGTH } from '@/lib/constants'
import { useAccountStore } from '@/store/accountStore'

interface AddonNoteEditorProps {
    accountId: string
    addonTransportUrl: string
    addonName: string
    addonLogo?: string
    note?: string
    index?: number
    className?: string
    asButton?: boolean
}

// Builds React elements without mutating props.children (was unsafe).
// List items are accumulated in a local array and only flushed when the list ends.

function renderMarkdown(text: string) {
    const lines = text.split('\n')
    const elements: React.ReactNode[] = []

    let listType: 'ul' | 'ol' | null = null
    let listItems: React.ReactNode[] = []

    const flushList = () => {
        if (!listType || listItems.length === 0) return
        const key = `list-${elements.length}`
        if (listType === 'ul') {
            elements.push(
                <ul key={key} className="list-disc pl-5 space-y-1 my-1">
                    {listItems}
                </ul>
            )
        } else {
            elements.push(
                <ol key={key} className="list-decimal pl-5 space-y-1 my-1">
                    {listItems}
                </ol>
            )
        }
        listType = null
        listItems = []
    }

    lines.forEach((line, i) => {
        const ulMatch = line.match(/^[-*]\s+(.+)/)
        const olMatch = line.match(/^\d+\.\s+(.+)/)

        if (ulMatch) {
            if (listType === 'ol') flushList()
            listType = 'ul'
            listItems.push(
                <li key={i} className="text-sm" dangerouslySetInnerHTML={{ __html: inlineFormat(ulMatch[1]) }} />
            )
            return
        }

        if (olMatch) {
            if (listType === 'ul') flushList()
            listType = 'ol'
            listItems.push(
                <li key={i} className="text-sm" dangerouslySetInnerHTML={{ __html: inlineFormat(olMatch[1]) }} />
            )
            return
        }

        flushList()

        if (line.startsWith('# ')) {
            elements.push(<h3 key={i} className="text-base font-bold mt-2 mb-1">{line.slice(2)}</h3>)
        } else if (line.startsWith('## ')) {
            elements.push(<h4 key={i} className="text-sm font-bold mt-2 mb-1">{line.slice(3)}</h4>)
        } else if (line.trim() === '') {
            elements.push(<div key={i} className="h-2" />)
        } else {
            elements.push(
                <p key={i} className="text-sm" dangerouslySetInnerHTML={{ __html: inlineFormat(line) }} />
            )
        }
    })

    flushList()
    return elements
}

export function AddonNoteEditor({
    accountId,
    addonTransportUrl,
    addonName,
    addonLogo,
    note,
    index,
    className,
    asButton = false,
}: AddonNoteEditorProps) {
    const [open, setOpen] = useState(false)
    // isEditing: false = view mode (rendered markdown), true = edit mode (textarea)
    const [isEditing, setIsEditing] = useState(false)
    const [value, setValue] = useState(note || '')
    const [history, setHistory] = useState<string[]>([note || ''])
    const [historyIndex, setHistoryIndex] = useState(0)
    const [hasChanges, setHasChanges] = useState(false)
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const savedRef = useRef(false)

    const hasNote = Boolean(note?.trim())
    const toolbarButtonClass = 'h-8 w-8 rounded-xl text-muted-foreground hover:bg-muted/50 hover:text-foreground'
    const noteLength = value.length
    const noteLimitExceeded = noteLength > STICKY_NOTE_MAX_LENGTH
    const noteNearLimit = noteLength >= STICKY_NOTE_MAX_LENGTH - 20
    const noteCountLabel = `${noteLength} / ${STICKY_NOTE_MAX_LENGTH}`

    useEffect(() => {
        if (open) {
            setValue(note || '')
            setHistory([note || ''])
            setHistoryIndex(0)
            setHasChanges(false)
            savedRef.current = false
            // Open in edit mode if no note yet, view mode if note exists
            setIsEditing(!note?.trim())
        }
    }, [open, note])

    const pushHistory = useCallback((val: string) => {
        setHasChanges(true)
        setHistory(prev => {
            const next = prev.slice(0, historyIndex + 1)
            next.push(val)
            return next.length > 100 ? next.slice(-100) : next
        })
        setHistoryIndex(prev => Math.min(prev + 1, 99))
    }, [historyIndex])

    const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const val = e.target.value
        if (val.length > STICKY_NOTE_MAX_LENGTH && val.length > value.length) return
        setValue(val)
        pushHistory(val)
    }, [value.length, pushHistory])

    const handleUndo = useCallback(() => {
        if (historyIndex > 0) {
            const ni = historyIndex - 1
            setHistoryIndex(ni)
            setValue(history[ni])
        }
    }, [historyIndex, history])

    const handleRedo = useCallback(() => {
        if (historyIndex < history.length - 1) {
            const ni = historyIndex + 1
            setHistoryIndex(ni)
            setValue(history[ni])
        }
    }, [historyIndex, history])

    const insertPrefix = useCallback((prefix: string) => {
        const textarea = textareaRef.current
        if (!textarea) return
        const start = textarea.selectionStart
        const lineStart = value.lastIndexOf('\n', start - 1) + 1
        const newVal = value.slice(0, lineStart) + prefix + value.slice(lineStart)
        if (newVal.length > STICKY_NOTE_MAX_LENGTH && newVal.length > value.length) return
        setValue(newVal)
        pushHistory(newVal)
        setTimeout(() => {
            textarea.selectionStart = textarea.selectionEnd = start + prefix.length
            textarea.focus()
        }, 0)
    }, [value, pushHistory])

    const wrapSelection = useCallback((before: string, after: string) => {
        const textarea = textareaRef.current
        if (!textarea) return
        const start = textarea.selectionStart
        const end = textarea.selectionEnd
        const selected = value.slice(start, end)
        const newVal = value.slice(0, start) + before + selected + after + value.slice(end)
        if (newVal.length > STICKY_NOTE_MAX_LENGTH && newVal.length > value.length) return
        setValue(newVal)
        pushHistory(newVal)
        setTimeout(() => {
            textarea.selectionStart = start + before.length
            textarea.selectionEnd = start + before.length + selected.length
            textarea.focus()
        }, 0)
    }, [value, pushHistory])

    const handleSave = useCallback(() => {
        if (hasChanges) {
            useAccountStore.getState().updateAddonSettings(
                accountId, addonTransportUrl, { note: value.trim() }, index
            )
            savedRef.current = true
            setHasChanges(false)
        }
        if (value.trim()) {
            setIsEditing(false)
        } else {
            setOpen(false)
        }
    }, [hasChanges, value, accountId, addonTransportUrl, index])

    const handleClose = useCallback(() => {
        if (hasChanges && !savedRef.current) {
            useAccountStore.getState().updateAddonSettings(
                accountId, addonTransportUrl, { note: value.trim() }, index
            )
        }
        setOpen(false)
    }, [hasChanges, value, accountId, addonTransportUrl, index])

    const handleClear = useCallback(() => {
        setValue('')
        pushHistory('')
    }, [pushHistory])

    return (
        <>
            {asButton ? (
                <Tooltip content={hasNote ? `Note: ${note!.slice(0, 60)}${note!.length > 60 ? '…' : ''}` : `Add note for ${addonName}`} side="top">
                <Button
                    size="sm"
                    onClick={() => setOpen(true)}
                    className={cn(
                        'font-semibold text-xs shadow-none flex-1 gap-1.5',
                        hasNote
                            ? 'bg-primary/12 text-primary border border-primary/25 hover:bg-primary/20'
                            : 'bg-muted/40 text-foreground/70 border border-border/40 hover:bg-muted/70',
                        className
                    )}
                >
                    <StickyNote className="h-3.5 w-3.5" />
                    {hasNote ? 'Edit Note' : 'Add Note'}
                </Button>
                </Tooltip>
            ) : (
                <Tooltip content={hasNote ? `Note: ${note!.slice(0, 60)}${note!.length > 60 ? '…' : ''}` : `Add note for ${addonName}`} side="top">
                <button
                    className={cn(
                        'rounded-md p-1.5 transition-colors',
                        hasNote
                            ? 'text-primary hover:text-primary/80 bg-primary/12'
                            : 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/50',
                        className
                    )}
                    onClick={() => setOpen(true)}
                >
                    <StickyNote className="h-3.5 w-3.5" />
                </button>
                </Tooltip>
            )}

            <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); else setOpen(true) }}>
                <DialogContent
                    className="flex max-h-[85vh] flex-col gap-0 overflow-hidden rounded-[1.75rem] border-border/45 bg-card p-0 shadow-[0_24px_80px_hsl(0_0%_0%/0.32)] sm:max-w-xl"
                    onMouseDown={e => e.stopPropagation()}
                    onTouchStart={e => e.stopPropagation()}
                >
                    <DialogHeader className="border-b border-border/25 px-5 py-4 pr-16">
                        <div className="flex items-center gap-3">
                            <AddonIcon
                                name={addonName}
                                logo={addonLogo}
                                className="h-10 w-10"
                                textClassName="text-xs"
                            />
                            <div className="min-w-0 flex-1">
                                <DialogTitle className="truncate text-base">{addonName}</DialogTitle>
                                <DialogDescription className="text-xs text-muted-foreground">
                                    {value.trim() ? 'Quick sticky note' : 'Write a quick sticky note'}
                                </DialogDescription>
                            </div>
                        </div>
                    </DialogHeader>

                    {isEditing ? (
                        <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
                            <div className="flex items-center gap-1 rounded-2xl border border-border/35 bg-muted/50 p-1">
                                <Tooltip content="Undo (Ctrl+Z)" side="top"><Button variant="ghost" size="icon" className={toolbarButtonClass} onClick={handleUndo} disabled={historyIndex === 0}><Undo2 className="h-3.5 w-3.5" /></Button></Tooltip>
                                <Tooltip content="Redo (Ctrl+Y)" side="top"><Button variant="ghost" size="icon" className={toolbarButtonClass} onClick={handleRedo} disabled={historyIndex >= history.length - 1}><Redo2 className="h-3.5 w-3.5" /></Button></Tooltip>
                                <div className="mx-1 h-5 w-px bg-border/60" />
                                <Tooltip content="Bold (Ctrl+B)" side="top"><Button variant="ghost" size="icon" className={toolbarButtonClass} onClick={() => wrapSelection('**', '**')}><Bold className="h-3.5 w-3.5" /></Button></Tooltip>
                                <Tooltip content="Italic (Ctrl+I)" side="top"><Button variant="ghost" size="icon" className={toolbarButtonClass} onClick={() => wrapSelection('*', '*')}><Italic className="h-3.5 w-3.5" /></Button></Tooltip>
                                <Tooltip content="Bullet list" side="top"><Button variant="ghost" size="icon" className={toolbarButtonClass} onClick={() => insertPrefix('- ')}><List className="h-3.5 w-3.5" /></Button></Tooltip>
                                <Tooltip content="Numbered list" side="top"><Button variant="ghost" size="icon" className={toolbarButtonClass} onClick={() => insertPrefix('1. ')}><ListOrdered className="h-3.5 w-3.5" /></Button></Tooltip>
                                <Tooltip content="Link" side="top"><Button variant="ghost" size="icon" className={toolbarButtonClass} onClick={() => wrapSelection('[', '](url)')}><Link className="h-3.5 w-3.5" /></Button></Tooltip>
                                <div className="flex-1" />
                                <CopyButton value={value} variant="ghost" iconSize={14} className={toolbarButtonClass} />
                                {value && (
                                    <Tooltip content="Clear note" side="top"><Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={handleClear}><Trash2 className="h-3.5 w-3.5" /></Button></Tooltip>
                                )}
                            </div>

                            <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-border/35 bg-background">
                                <Textarea
                                    ref={textareaRef}
                                    data-autofocus="true"
                                    value={value}
                                    onChange={handleChange}
                                    maxLength={STICKY_NOTE_MAX_LENGTH}
                                    placeholder={"Write anything...\n\n- Use bullet lists\n1. Or numbered lists\n**bold** and *italic*"}
                                    className="h-full min-h-[220px] resize-none whitespace-pre-wrap break-words overflow-wrap-anywhere border-0 bg-transparent p-4 text-sm leading-relaxed focus-visible:ring-0"
                                    onKeyDown={(e) => {
                                        if (e.key === 'Escape') { handleSave() }
                                        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); handleUndo() }
                                        if ((e.ctrlKey || e.metaKey) && (e.key === 'Z' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); handleRedo() }
                                        if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); handleRedo() }
                                        if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); handleSave() }
                                        if ((e.ctrlKey || e.metaKey) && e.key === 'b') { e.preventDefault(); wrapSelection('**', '**') }
                                        if ((e.ctrlKey || e.metaKey) && e.key === 'i') { e.preventDefault(); wrapSelection('*', '*') }
                                        if (e.key === 'Enter') {
                                            const textarea = e.currentTarget
                                            const pos = textarea.selectionStart
                                            const lineStart = value.lastIndexOf('\n', pos - 1) + 1
                                            const currentLine = value.slice(lineStart, pos)
                                            const ulMatch = currentLine.match(/^(\s*)([-*])\s/)
                                            const olMatch = currentLine.match(/^(\s*)(\d+)\.\s/)
                                            if (ulMatch) {
                                                e.preventDefault()
                                                if (currentLine.trim() === '- ' || currentLine.trim() === '* ') {
                                                    const newVal = value.slice(0, lineStart) + value.slice(pos)
                                                    setValue(newVal); pushHistory(newVal)
                                                    setTimeout(() => { textarea.selectionStart = textarea.selectionEnd = lineStart }, 0)
                                                } else {
                                                    const { 1: indent, 2: bullet } = ulMatch
                                                    const newVal = value.slice(0, pos) + '\n' + indent + bullet + ' ' + value.slice(pos)
                                                    if (newVal.length > STICKY_NOTE_MAX_LENGTH && newVal.length > value.length) return
                                                    setValue(newVal); pushHistory(newVal)
                                                    setTimeout(() => { textarea.selectionStart = textarea.selectionEnd = pos + 1 + indent.length + 2 }, 0)
                                                }
                                            } else if (olMatch) {
                                                e.preventDefault()
                                                const { 1: indent, 2: numStr } = olMatch
                                                if (currentLine.trim() === numStr + '. ') {
                                                    const newVal = value.slice(0, lineStart) + value.slice(pos)
                                                    setValue(newVal); pushHistory(newVal)
                                                    setTimeout(() => { textarea.selectionStart = textarea.selectionEnd = lineStart }, 0)
                                                } else {
                                                    const num = parseInt(numStr) + 1
                                                    const newVal = value.slice(0, pos) + '\n' + indent + num + '. ' + value.slice(pos)
                                                    if (newVal.length > STICKY_NOTE_MAX_LENGTH && newVal.length > value.length) return
                                                    setValue(newVal); pushHistory(newVal)
                                                    setTimeout(() => { textarea.selectionStart = textarea.selectionEnd = pos + 1 + indent.length + num.toString().length + 2 }, 0)
                                                }
                                            }
                                        }
                                    }}
                                />
                            </div>

                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <span className={cn(
                                    'text-xs text-muted-foreground',
                                    noteLimitExceeded ? 'text-destructive' : noteNearLimit && 'text-warning'
                                )}>
                                    {noteLength > 0 ? `${noteCountLabel} chars` : `${noteCountLabel} · Auto-saves when closed`}
                                </span>
                                <Button
                                    size="sm"
                                    onClick={() => { handleSave(); setOpen(false) }}
                                    className="h-9 rounded-full px-4 text-xs font-semibold gap-1.5"
                                >
                                    <Check className="h-3 w-3" /> Save & Close
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
                            <div className="min-h-[160px] overflow-auto rounded-2xl border border-border/35 bg-background p-4 text-sm leading-relaxed space-y-1 prose-sm break-words overflow-wrap-anywhere">
                                {renderMarkdown(value)}
                            </div>
                            <div className="flex items-center justify-end">
                                <Button
                                    variant="subtle"
                                    size="sm"
                                    onClick={() => { setIsEditing(true); setTimeout(() => textareaRef.current?.focus(), 50) }}
                                    className="h-9 rounded-full gap-1.5 px-4"
                                >
                                    <Pencil className="h-3 w-3" /> Edit
                                </Button>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </>
    )
}
