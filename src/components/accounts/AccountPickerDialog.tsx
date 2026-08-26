import { Button, type ButtonProps } from '@/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useAccountStore, getAccountEmail } from '@/store/accountStore'
import { accountMatchesQuery } from '@/lib/account-compat'
import { useUIStore } from '@/store/uiStore'
import { maskNameLevel, maskEmailLevel } from '@/lib/utils'
import { User, Search, X } from 'lucide-react'
import { useCallback, useEffect, useState, useMemo } from 'react'
import type { ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'

interface AccountPickerDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    title: string
    description: string
    onConfirm: (accountIds: string[]) => Promise<void>
    confirmLabel?: string
    confirmVariant?: ButtonProps['variant']
    renderPreview?: (accountIds: string[]) => ReactNode
}

export function AccountPickerDialog({
    open,
    onOpenChange,
    title,
    description,
    onConfirm,
    confirmLabel = 'Confirm',
    confirmVariant = 'default',
    renderPreview,
}: AccountPickerDialogProps) {
    const accounts = useAccountStore((state) => state.accounts)
    const isPrivacyModeEnabled = useUIStore(s => s.isPrivacyModeEnabled)
    const privacyLevelNames = useUIStore(s => s.privacyLevelNames)
    const namePrivacy = isPrivacyModeEnabled ? privacyLevelNames : 0
    const { toast } = useToast()
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
    const [searchQuery, setSearchQuery] = useState('')
    const [loading, setLoading] = useState(false)

    const resetDialogState = useCallback(() => {
        setSelectedIds(new Set())
        setSearchQuery('')
    }, [])

    useEffect(() => {
        if (!open) {
            resetDialogState()
        }
    }, [open, resetDialogState])

    const filteredAccounts = useMemo(() => {
        if (!searchQuery.trim()) return accounts
        return accounts.filter(acc => accountMatchesQuery(acc, searchQuery))
    }, [accounts, searchQuery])

    const selectedAccountIds = useMemo(() => Array.from(selectedIds), [selectedIds])

    const toggleAccount = (id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    const handleSelectAll = () => {
        if (selectedIds.size === filteredAccounts.length) {
            setSelectedIds(new Set())
        } else {
            setSelectedIds(new Set(filteredAccounts.map(a => a.id)))
        }
    }

    const handleOpenChange = (nextOpen: boolean) => {
        if (!nextOpen) {
            resetDialogState()
        }
        onOpenChange(nextOpen)
    }

    const handleConfirm = async () => {
        setLoading(true)
        try {
            await onConfirm(Array.from(selectedIds))
            handleOpenChange(false)
        } catch (error) {
            toast({
                title: `${confirmLabel} failed`,
                description: error instanceof Error ? error.message : 'Unknown error',
                variant: 'destructive',
            })
        } finally {
            setLoading(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>

                <div className="min-w-0 space-y-4 py-4">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search accounts..."
                            className="pl-10"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                        {searchQuery && (
                            <Button
                                variant="ghost"
                                size="icon"
                                className="absolute right-1 top-1/2 transform -translate-y-1/2 h-7 w-7 flex items-center justify-center"
                                onClick={() => setSearchQuery('')}
                            >
                                <X className="h-4 w-4" />
                            </Button>
                        )}
                    </div>

                    <div className="flex items-center justify-between px-2">
                        <Label className="text-xs font-medium text-muted-foreground">
                            {selectedIds.size} accounts selected
                        </Label>
                        <Button variant="link" size="sm" onClick={handleSelectAll} className="h-auto p-0 text-xs">
                            {selectedIds.size === filteredAccounts.length ? 'Deselect All' : 'Select All'}
                        </Button>
                    </div>

                    <ScrollArea className="h-64 rounded-md border p-2">
                        <div className="space-y-1">
                            {filteredAccounts.map((account) => (
                                <label
                                    key={account.id}
                                    className="flex items-center gap-3 p-2 hover:bg-muted/50 rounded-md cursor-pointer transition-colors"
                                >
                                    <Checkbox
                                        checked={selectedIds.has(account.id)}
                                        onCheckedChange={() => toggleAccount(account.id)}
                                    />
                                    <div className="flex items-center gap-2 min-w-0">
                                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                            <User className="h-4 w-4 text-primary" />
                                        </div>
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2">
                                                {account.avatar ? (
                                                    <img src={account.avatar} alt="" className="h-5 w-5 shrink-0 rounded-full object-cover" loading="lazy" />
                                                ) : account.emoji ? (
                                                    <span className="text-base shrink-0">{account.emoji}</span>
                                                ) : null}
                                                <p className="text-sm font-medium truncate">{maskNameLevel(account.name, namePrivacy)}</p>
                                            </div>
                                            <p className="text-xs text-muted-foreground truncate">{maskEmailLevel(getAccountEmail(account) || '', namePrivacy)}</p>
                                        </div>
                                    </div>
                                </label>
                            ))}
                            {filteredAccounts.length === 0 && (
                                <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
                                    <div className="rounded-full bg-muted/50 p-3 text-muted-foreground">
                                        <User className="h-6 w-6" />
                                    </div>
                                    <p className="text-sm text-muted-foreground">No accounts found</p>
                                </div>
                            )}
                        </div>
                    </ScrollArea>

                    {renderPreview && selectedAccountIds.length > 0 && (
                        <div className="min-w-0">
                            {renderPreview(selectedAccountIds)}
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="subtle" onClick={() => handleOpenChange(false)} disabled={loading}>
                        Cancel
                    </Button>
                    <Button variant={confirmVariant} onClick={handleConfirm} disabled={selectedIds.size === 0 || loading}>
                        {confirmLabel}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
