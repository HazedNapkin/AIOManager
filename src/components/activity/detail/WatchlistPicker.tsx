import { useState, useEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Search, Users, Check, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTheme } from '@/contexts/ThemeContext'
import { useUIStore } from '@/store/uiStore'
import { AccountAvatar as AccountSwitcherAvatar, maskedDisplayName } from '@/components/common/AccountSwitcher'
import type { Account } from '@/types/account'

interface WatchlistPickerProps {
    accounts: Account[]
    watchlistTargets: Set<string>
    onToggle: (id: string) => void
    loading: boolean
}

export function WatchlistPicker({
    accounts,
    watchlistTargets,
    onToggle,
    loading,
}: WatchlistPickerProps) {
    const { isLight } = useTheme()
    const isPrivacyModeEnabled = useUIStore(s => s.isPrivacyModeEnabled)
    const privacyLevelNames = useUIStore(s => s.privacyLevelNames)
    const privacyLevel = isPrivacyModeEnabled ? privacyLevelNames : 0

    const heroPrimaryBtn = isLight
        ? 'bg-primary text-primary-foreground hover:bg-primary/90'
        : 'bg-white text-black hover:bg-white/90'
    const heroGhostBtn = isLight
        ? 'border border-border bg-card/80 text-foreground hover:bg-card'
        : 'border border-white/20 bg-white/10 text-white hover:bg-white/20'

    const [open, setOpen] = useState(false)
    const [search, setSearch] = useState('')
    const searchRef = useRef<HTMLInputElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const dropdownRef = useRef<HTMLDivElement>(null)
    const buttonRef = useRef<HTMLButtonElement>(null)
    const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null)

    useEffect(() => {
        if (open) {
            setSearch('')
            setTimeout(() => searchRef.current?.focus(), 0)
            const updatePos = () => {
                if (buttonRef.current) {
                    const rect = buttonRef.current.getBoundingClientRect()
                    const width = Math.max(rect.width, 280)
                    const left = Math.min(rect.left, window.innerWidth - width - 8)
                    setDropdownPos({ top: rect.bottom + 4, left: Math.max(8, left), width })
                }
            }
            updatePos()
            window.addEventListener('resize', updatePos)
            window.addEventListener('scroll', updatePos, true)
            return () => {
                window.removeEventListener('resize', updatePos)
                window.removeEventListener('scroll', updatePos, true)
            }
        } else {
            setDropdownPos(null)
        }
    }, [open])

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (
                containerRef.current && !containerRef.current.contains(e.target as Node) &&
                (!dropdownRef.current || !dropdownRef.current.contains(e.target as Node))
            ) {
                setOpen(false)
            }
        }
        if (open) document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [open])

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && open) setOpen(false)
        }
        if (open) document.addEventListener('keydown', handler)
        return () => document.removeEventListener('keydown', handler)
    }, [open])

    const filtered = useMemo(() => {
        if (!search.trim()) return accounts
        const q = search.toLowerCase()
        return accounts.filter(a =>
            (a.name || '').toLowerCase().includes(q) ||
            (a.email || '').toLowerCase().includes(q)
        )
    }, [accounts, search])

    const hasUniversal = watchlistTargets.has('')
    const hasAccounts = accounts.length > 0

    const dropdown = open && dropdownPos ? createPortal(
        <div
            ref={dropdownRef}
            style={{ position: 'fixed', top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width, zIndex: 100 }}
            className="bg-card border border-border/40 rounded-2xl shadow-lg overflow-hidden"
        >
            <div className="p-2 border-b border-border/40">
                <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <input
                        ref={searchRef}
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search accounts..."
                        className="w-full h-8 pl-8 pr-3 text-xs bg-muted/30 border border-border/40 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/30"
                    />
                </div>
            </div>
            <div className="max-h-80 overflow-y-auto p-1">
                <button
                    type="button"
                    onClick={() => onToggle('')}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs rounded-lg transition-colors ${hasUniversal ? 'bg-primary/12 text-primary border border-primary/25' : 'border border-transparent hover:bg-muted/50'}`}
                >
                    <div className="w-6 h-6 rounded-full bg-muted/40 flex items-center justify-center shrink-0">
                        <Users className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                    <span className="flex-1 text-left truncate font-semibold">Universal Watchlist</span>
                    {hasUniversal && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                </button>
                {hasAccounts && (
                    <div className="my-1 border-t border-border/40" />
                )}
                {hasAccounts && filtered.length === 0 && (
                    <div className="px-3 py-4 text-xs text-muted-foreground text-center">No accounts found</div>
                )}
                {filtered.map(acc => {
                    const selected = watchlistTargets.has(acc.id)
                    const maskedName = maskedDisplayName(acc.name, acc.email, privacyLevel)
                    return (
                        <button
                            key={acc.id}
                            type="button"
                            onClick={() => onToggle(acc.id)}
                            className={`w-full flex items-center gap-2 px-3 py-2 text-xs rounded-lg transition-colors ${selected ? 'bg-primary/12 text-primary border border-primary/25' : 'border border-transparent hover:bg-muted/50'}`}
                        >
                            <AccountSwitcherAvatar account={acc} size="sm" />
                            <span className="flex-1 text-left truncate">{maskedName || 'Unknown Account'}</span>
                            {selected && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                        </button>
                    )
                })}
            </div>
        </div>,
        document.body
    ) : null

    return (
        <div ref={containerRef} className="relative inline-flex flex-1 sm:flex-none">
            <button
                ref={buttonRef}
                type="button"
                disabled={loading}
                onClick={() => setOpen(!open)}
                className={cn('inline-flex h-11 flex-1 justify-center items-center gap-2 rounded-full px-6 text-sm font-semibold backdrop-blur-md transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50 sm:flex-none sm:w-auto sm:justify-start', watchlistTargets.size > 0 ? heroPrimaryBtn : heroGhostBtn)}
            >
                {watchlistTargets.size > 0 ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {watchlistTargets.size > 0 ? 'In a Watchlist' : 'Watchlist'}
            </button>
            {dropdown}
        </div>
    )
}
