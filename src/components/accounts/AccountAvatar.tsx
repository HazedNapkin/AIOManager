import { useEffect, useState } from 'react'
import { Tooltip } from '@/components/ui/tooltip'
import { Account } from '@/types/account'
import { cn } from '@/lib/utils'

type Size = 'xs' | 'sm' | 'md' | 'lg'

interface AccountAvatarProps {
    account: Pick<Account, 'name' | 'email' | 'emoji' | 'avatar'> & Partial<Pick<Account, 'status'>>
    size?: Size
    showStatus?: boolean
    pulse?: boolean
    className?: string
}

const SIZE_MAP: Record<Size, { box: string; letter: string; emoji: string; dot: string }> = {
    xs: { box: 'w-6 h-6', letter: 'text-xs', emoji: 'text-xs', dot: 'w-2 h-2' },
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

    const [avatarFailed, setAvatarFailed] = useState(false)
    useEffect(() => { setAvatarFailed(false) }, [account.avatar])
    const showAvatar = !!account.avatar && !avatarFailed

    return (
        <div
            data-theme-part="account-avatar"
            className={cn('relative shrink-0 flex items-center justify-center rounded-xl', dim.box, className)}
        >
            {/* Same muted backdrop the global SquircleOverlay paints, kept local so skins
                can suppress the fixed squircle clip with --theme-avatar-filter and apply
                the theme radius instead. Inner-surface radius comes from the shared theme
                STATE_DETAILS (border-radius: inherit) via the account-avatar-* hooks. */}
            <div
                data-theme-part="account-avatar-surface"
                className="absolute inset-0 rounded-[inherit] bg-muted"
                style={{ filter: 'var(--theme-avatar-filter, url(#squircle))' }}
            />
            {showAvatar ? (
                <img
                    src={account.avatar}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    onError={() => setAvatarFailed(true)}
                    data-theme-part="account-avatar-image"
                    className="absolute inset-0 h-full w-full rounded-[inherit] object-cover z-10"
                    style={{ filter: 'var(--theme-avatar-filter, url(#squircle))' }}
                />
            ) : (
                <span className={cn('relative z-10 leading-none', dim.emoji)}>
                    {account.emoji ? account.emoji : (
                        <span className={cn('font-bold text-muted-foreground', dim.letter)}>
                            {initial}
                        </span>
                    )}
                </span>
            )}
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
