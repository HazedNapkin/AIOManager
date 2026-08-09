import { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, ChevronDown, Search } from 'lucide-react'
import { Tooltip } from '@/components/ui/tooltip'
import { SquircleOverlay } from '@/components/ui/squircle-overlay'
import { maskNameLevel, maskEmailLevel } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'

export function maskedDisplayName(name: string, email: string | undefined, privacyLevel: number): string {
    if (name && !name.includes('@')) return maskNameLevel(name, privacyLevel)
    const emailStr = name && name.includes('@') ? name : (email || '')
    return maskEmailLevel(emailStr, privacyLevel) || name || email || ''
}

interface Account {
    id: string
    name: string
    email?: string
    emoji?: string
    avatar?: string
}

interface PaginationModeProps {
    mode: 'pagination'
    accounts: Account[]
    selectedId: string
    onSelect: (id: string) => void
    onPrev: () => void
    onNext: () => void
    prevLabel?: string
    nextLabel?: string
}

interface FilterModeProps {
    mode: 'filter'
    accounts: Account[]
    selectedId: string | 'all'
    onSelect: (id: string) => void
    allLabel?: string
    placeholder?: string
    buttonClassName?: string
}

type AccountSwitcherProps = PaginationModeProps | FilterModeProps

const OUTLINE_BTN = "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl text-xs font-medium h-8 px-3 border border-border/40 bg-muted/30 shadow-sm hover:bg-muted/50 hover:text-foreground transition-colors"

export function AccountAvatar({ account, size = 'sm' }: { account: Account; size?: 'sm' | 'md' }) {
    const dim = size === 'sm' ? 'w-5 h-5' : 'w-6 h-6'
    const fontSize = size === 'sm' ? 'text-xs' : 'text-xs'
    const isPrivacyModeEnabled = useUIStore(s => s.isPrivacyModeEnabled)
    const privacyLevelNames = useUIStore(s => s.privacyLevelNames)
    const privacyLevel = isPrivacyModeEnabled ? privacyLevelNames : 0
    const initial = account.emoji || (maskedDisplayName(account.name, account.email, privacyLevel)[0] || '?').toUpperCase()
    const [avatarFailed, setAvatarFailed] = useState(false)
    useEffect(() => { setAvatarFailed(false) }, [account.avatar])
    const showAvatar = !!account.avatar && !avatarFailed
    return (
        <div className={`relative ${dim} shrink-0 flex items-center justify-center`}>
            <SquircleOverlay />
            {showAvatar ? (
                <img
                    src={account.avatar}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    onError={() => setAvatarFailed(true)}
                    className="absolute inset-0 h-full w-full object-cover z-10"
                    style={{ filter: 'url(#squircle)' }}
                />
            ) : (
                <span className={`relative z-10 ${fontSize} font-bold text-muted-foreground`}>
                    {initial}
                </span>
            )}
        </div>
    )
}

function SearchableDropdown({
    accounts,
    selectedId,
    onSelect,
    allLabel,
    searchPlaceholder,
    buttonClassName,
    dropdownMinWidth,
}: {
    accounts: Account[]
    selectedId: string
    onSelect: (id: string) => void
    allLabel?: string
    searchPlaceholder?: string
    buttonClassName?: string
    dropdownMinWidth?: number
}) {
    const [open, setOpen] = useState(false)
    const [search, setSearch] = useState('')
    const searchRef = useRef<HTMLInputElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const dropdownRef = useRef<HTMLDivElement>(null)
    const buttonRef = useRef<HTMLButtonElement>(null)
    const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null)
    const isPrivacyModeEnabled = useUIStore(s => s.isPrivacyModeEnabled)
    const privacyLevelNames = useUIStore(s => s.privacyLevelNames)
    const privacyLevel = isPrivacyModeEnabled ? privacyLevelNames : 0

    useEffect(() => {
        if (open) {
            setSearch('')
            setTimeout(() => searchRef.current?.focus(), 0)
            const updatePos = () => {
                if (buttonRef.current) {
                    const pill = buttonRef.current.closest('[data-account-switcher-pill]') as HTMLElement | null
                    const refEl = pill || buttonRef.current
                    const rect = refEl.getBoundingClientRect()
                    setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, dropdownMinWidth || 0) })
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
    }, [open, dropdownMinWidth])

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

    const filtered = useMemo(() => {
        if (!search.trim()) return accounts
        const q = search.toLowerCase()
        return accounts.filter(a =>
            (a.name || '').toLowerCase().includes(q) ||
            (a.email || '').toLowerCase().includes(q)
        )
    }, [accounts, search])

    const selectedAccount = accounts.find(a => a.id === selectedId)

    const dropdown = open && dropdownPos ? createPortal(
        <div
            ref={dropdownRef}
            style={{ position: 'fixed', top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width, zIndex: 40 }}
            className="bg-card border border-border/40 rounded-2xl shadow-lg overflow-hidden"
        >
            <div className="p-2 border-b border-border/40">
                <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <input
                        ref={searchRef}
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder={searchPlaceholder || 'Search accounts...'}
                        className="w-full h-8 pl-8 pr-3 text-xs bg-muted/30 border border-border/40 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/30"
                    />
                </div>
            </div>
            <div className="max-h-60 overflow-y-auto p-1">
                {allLabel && (
                    <button
                        onClick={() => { onSelect('all'); setOpen(false) }}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-xs rounded-lg transition-colors ${selectedId === 'all' ? 'bg-primary/12 text-primary border border-primary/25' : 'hover:bg-muted/50'}`}
                    >
                        {allLabel}
                    </button>
                )}
                {filtered.length === 0 && (
                    <div className="px-3 py-4 text-xs text-muted-foreground text-center">No accounts found</div>
                )}
                {filtered.map(acc => (
                    <button
                        key={acc.id}
                        onClick={() => { onSelect(acc.id); setOpen(false) }}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-xs rounded-lg transition-colors ${acc.id === selectedId ? 'bg-primary/12 text-primary border border-primary/25' : 'hover:bg-muted/50'}`}
                    >
                        <AccountAvatar account={acc} size="sm" />
                        <span className="truncate">{maskedDisplayName(acc.name, acc.email, privacyLevel) || 'Unknown Account'}</span>
                    </button>
                ))}
            </div>
        </div>,
        document.body
    ) : null

    return (
        <div ref={containerRef}>
            <button
                ref={buttonRef}
                onClick={() => setOpen(!open)}
                className={buttonClassName || OUTLINE_BTN}
            >
                {selectedAccount ? (
                    <>
                        <AccountAvatar account={selectedAccount} size="sm" />
                        <span className="flex-1 text-left truncate">{maskedDisplayName(selectedAccount.name, selectedAccount.email, privacyLevel)}</span>
                    </>
                ) : allLabel ? (
                    <span className="flex-1 text-left truncate">{allLabel}</span>
                ) : (
                    <span className="flex-1 text-left truncate">Select</span>
                )}
                <ChevronDown className="h-4 w-4 opacity-50 ml-auto shrink-0" />
            </button>
            {dropdown}
        </div>
    )
}

export function AccountSwitcher(props: AccountSwitcherProps) {
    if (props.mode === 'filter') {
        const { accounts, selectedId, onSelect, allLabel, placeholder, buttonClassName } = props
        return (
            <SearchableDropdown
                accounts={accounts}
                selectedId={selectedId}
                onSelect={onSelect}
                allLabel={allLabel}
                searchPlaceholder={placeholder}
                buttonClassName={buttonClassName}
                dropdownMinWidth={220}
            />
        )
    }

    const { accounts, selectedId, onSelect, onPrev, onNext, prevLabel, nextLabel } = props
    const currentIndex = accounts.findIndex(a => a.id === selectedId)

    return (
        <div className="inline-flex items-center gap-1.5">
            <div className="[&>div]:contents">
                <SearchableDropdown
                    accounts={accounts}
                    selectedId={selectedId}
                    onSelect={onSelect}
                    buttonClassName={OUTLINE_BTN + " gap-1.5 w-auto"}
                />
            </div>
            <Tooltip content={prevLabel || 'Previous account'} side="bottom">
                <button className={OUTLINE_BTN + " px-2"} onClick={onPrev}>
                    <ChevronLeft className="h-4 w-4" />
                </button>
            </Tooltip>
            <span className={OUTLINE_BTN + " px-2 tabular-nums select-none pointer-events-none"}>
                {currentIndex >= 0 ? currentIndex + 1 : '-'}/{accounts.length}
            </span>
            <Tooltip content={nextLabel || 'Next account'} side="bottom">
                <button className={OUTLINE_BTN + " px-2"} onClick={onNext}>
                    <ChevronRight className="h-4 w-4" />
                </button>
            </Tooltip>
        </div>
    )
}
