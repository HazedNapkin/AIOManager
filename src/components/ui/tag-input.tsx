import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { X } from 'lucide-react'
import { ClipboardEvent, FocusEvent, KeyboardEvent, useId, useMemo, useState } from 'react'

interface TagInputProps {
    value: string[]
    onChange: (tags: string[]) => void
    placeholder?: string
    suggestions?: string[]
}

export function TagInput({ value, onChange, placeholder, suggestions }: TagInputProps) {
    const [inputValue, setInputValue] = useState('')
    const [isFocused, setIsFocused] = useState(false)
    const suggestionMenuId = useId()

    const visibleSuggestions = useMemo(() => {
        if (!suggestions?.length) return []
        const query = inputValue.trim().toLowerCase()
        return suggestions
            .filter((tag) => !value.includes(tag))
            .filter((tag) => !query || tag.toLowerCase().includes(query))
            .slice(0, 12)
    }, [inputValue, suggestions, value])

    const addTags = (input: string) => {
        const newTags = input
            .split(/[,,;]/)
            .map((t) => t.trim().replace(/[,,;]$/, ''))
            .filter((t) => t && !value.includes(t))

        if (newTags.length > 0) {
            onChange([...value, ...newTags])
            setInputValue('')
            setIsFocused(false)
        } else if (!input.trim()) {
            setInputValue('')
            setIsFocused(false)
        }
    }

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
            e.preventDefault()
            addTags(inputValue)
        } else if (e.key === 'Backspace' && !inputValue && value.length > 0) {
            onChange(value.slice(0, -1))
        }
    }

    const handleBlur = () => {
        if (inputValue.trim()) {
            addTags(inputValue)
        }
    }

    const handlePaste = (e: ClipboardEvent) => {
        e.preventDefault()
        const paste = e.clipboardData.getData('text')
        addTags(paste)
    }

    const removeTag = (tag: string) => {
        onChange(value.filter((t) => t !== tag))
    }

    const selectSuggestion = (tag: string) => {
        if (!value.includes(tag)) {
            onChange([...value, tag])
        }
        setInputValue('')
        setIsFocused(true)
    }

    const handleContainerBlur = (e: FocusEvent<HTMLDivElement>) => {
        const nextFocus = e.relatedTarget as Node | null
        if (!nextFocus || !e.currentTarget.contains(nextFocus)) {
            setIsFocused(false)
            handleBlur()
        }
    }

    const dropdownOpen = isFocused && visibleSuggestions.length > 0

    return (
        <div
            className="relative flex flex-wrap gap-2 p-2 border border-border/40 rounded-xl bg-muted/30 focus-within:ring-2 focus-within:ring-ring/20 focus-within:border-ring"
            onFocus={() => setIsFocused(true)}
            onBlur={handleContainerBlur}
        >
            {value.map((tag) => (
                <Badge key={tag} variant="secondary" className="gap-1 pr-1">
                    {tag}
                    <button
                        type="button"
                        aria-label={`Remove ${tag} tag`}
                        className="rounded-full hover:bg-foreground/20 p-0.5 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        onClick={() => removeTag(tag)}
                    >
                        <X className="h-3 w-3" />
                    </button>
                </Badge>
            ))}
            <div className="flex-1 min-w-[120px]">
                <Input
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    placeholder={value.length === 0 ? placeholder : ''}
                    className="border-0 focus-visible:ring-0 px-0 h-6 text-sm bg-transparent placeholder:text-muted-foreground"
                    aria-expanded={dropdownOpen}
                    aria-controls={suggestionMenuId}
                    aria-haspopup="listbox"
                />
            </div>
            {inputValue.trim() && (
                <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs text-primary"
                    onClick={() => addTags(inputValue)}
                >
                    Add
                </Button>
            )}
            {dropdownOpen && (
                <div
                    id={suggestionMenuId}
                    role="listbox"
                    className="absolute left-0 right-0 top-full z-50 mt-2 max-h-48 overflow-y-auto rounded-lg border border-border/60 bg-card p-1 shadow-xl"
                >
                    <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Existing tags
                    </div>
                    {visibleSuggestions.map((tag) => (
                        <button
                            key={tag}
                            type="button"
                            role="option"
                            aria-selected={false}
                            className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted/60 focus:bg-muted/60 focus:outline-none"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => selectSuggestion(tag)}
                        >
                            <span className="truncate">{tag}</span>
                            <span className="text-[11px] font-medium text-muted-foreground">Add</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}
