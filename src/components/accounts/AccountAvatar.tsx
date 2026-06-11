import { SquircleOverlay } from '@/components/ui/squircle-overlay'
import { Tooltip } from '@/components/ui/tooltip'
import { StremioAccount } from '@/types/account'
import { cn } from '@/lib/utils'

type Size = 'xs' | 'sm' | 'md' | 'lg'

interface AccountAvatarProps {
    account: Pick<StremioAccount, 'name' | 'email' | 'emoji' | 'status'>
    size?: Size
    showStatus?: boolean
    pulse?: boolean
    className?: string
}

const SIZE_MAP: Record<Size, { box: string; letter: string; emoji: string; dot: string }> = {
    xs: { box: 'w-6 h-6', letter: 'text-[10px]', emoji: 'text-xs', dot: 'w-2 h-2' },
    sm: { box: 'w-8 h-8', letter: 'text-xs', emoji: 'text-sm', dot: 'w-2 h-2' },
    md: { box: 'w-9 h-9', letter: 'text-sm', emoji: 'text-base', dot: 'w-2.5 h-2.5' },
    lg: { box: 'w-10 h-10', letter: 'text-sm', emoji: 'text-lg', dot: 'w-2.5 h-2.5' },
}

const STATUS_TEXT: Record<string, string> = {
    active: 'Active',
    expired: 'Session Expired',
    error: 'Error',
}

const STATUS_BG: Record<string, string> = {
    active: 'bg-success',
    expired: 'bg-warning',
    error: 'bg-destructive',
}

export function AccountAvatar({
    account,
    size = 'md',
    showStatus,
    pulse,
    className,
}: AccountAvatarProps) {
    const dim = SIZE_MAP[size]
    const initial = (account.name || account.email || '?')[0]?.toUpperCase()
    const status = account.status as string | undefined
    const shouldShowStatus = showStatus ?? !!status
    const isPulsing = pulse ?? status === 'active'

    return (
        <div className={cn('relative shrink-0 flex items-center justify-center', dim.box, className)}>
            <SquircleOverlay />
            <span className={cn('relative z-10 leading-none', dim.emoji)}>
                {account.emoji ? account.emoji : (
                    <span className={cn('font-bold text-muted-foreground', dim.letter)}>
                        {initial}
                    </span>
                )}
            </span>
            {shouldShowStatus && status && (
                <Tooltip content={STATUS_TEXT[status] || status} side="top">
                    <span
                        className={cn(
                            'absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-card z-20',
                            dim.dot,
                            STATUS_BG[status] || 'bg-muted-foreground/60',
                            isPulsing && 'animate-pulse'
                        )}
                        aria-label={`Account status: ${status}`}
                    />
                </Tooltip>
            )}
        </div>
    )
}
