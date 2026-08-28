import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AccountAvatar } from '@/components/accounts/AccountAvatar'
import type { ProfileRosterState, ProfileClaim } from '@/lib/profile-claims'

export interface RosterRowProfile {
    name: string
    index: number
    avatarColorHex?: string
}

interface ProfileRosterRowProps {
    profile: RosterRowProfile
    state: ProfileRosterState
    /** Required when state is 'claimed': who owns this profile. */
    claimedBy?: ProfileClaim
    onAdd?: () => void
    onNavigate?: () => void
    disabled?: boolean
}

const ROW_CLASS = cn(
    'group flex w-full items-center gap-3 rounded-2xl border border-border/40 bg-card px-3.5 py-2.5',
    'text-left text-sm shadow-sm transition-[background-color,border-color,box-shadow,transform] duration-200',
)

const HOVER_CLASS = 'hover:-translate-y-0.5 hover:border-border/70 hover:bg-card/95 hover:shadow-md'

function IndexBadge({ index, colorHex }: { index: number; colorHex?: string }) {
    return (
        <span
            className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-[11px] font-bold',
                !colorHex && 'text-muted-foreground',
            )}
            style={colorHex ? { backgroundColor: `${colorHex}26`, color: colorHex } : undefined}
        >
            {index}
        </span>
    )
}

function ActiveChip() {
    return (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/25 bg-primary/12 px-1.5 py-0.5 text-[11px] font-medium text-primary">
            <Check className="h-3 w-3" />
            Active
        </span>
    )
}

/**
 * Shared 3-state roster row (spec docs/profile-quick-add-spec.md).
 * Visual sibling of the platform workspace rows, not a new language:
 * same border/bg/radius/hover treatment as the pickers and profile lists.
 */
export function ProfileRosterRow({ profile, state, claimedBy, onAdd, onNavigate, disabled }: ProfileRosterRowProps) {
    if (state === 'active-here') {
        return (
            <div className={cn(ROW_CLASS, 'cursor-default')}>
                <IndexBadge index={profile.index} colorHex={profile.avatarColorHex} />
                <span className="min-w-0 flex-1 truncate font-medium">{profile.name}</span>
                <ActiveChip />
            </div>
        )
    }

    const action = state === 'claimed' ? onNavigate : state === 'unclaimed' ? onAdd : undefined
    const interactive = !disabled && !!action

    return (
        <button
            type="button"
            onClick={interactive ? action : undefined}
            disabled={!interactive}
            className={cn(
                ROW_CLASS,
                interactive && HOVER_CLASS,
                !interactive && 'cursor-default',
                disabled && 'pointer-events-none opacity-60',
            )}
        >
            <IndexBadge index={profile.index} colorHex={profile.avatarColorHex} />
            <span className="min-w-0 flex-1 truncate font-medium">{profile.name}</span>
            {state === 'claimed' ? (
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border/40 bg-muted/40 py-0.5 pl-0.5 pr-2 text-[11px] font-medium text-muted-foreground">
                    {claimedBy ? (
                        <AccountAvatar
                            size="sm"
                            showStatus={false}
                            account={{
                                name: claimedBy.accountName,
                                email: claimedBy.accountEmail,
                                emoji: claimedBy.emoji,
                                avatar: claimedBy.avatar,
                                status: claimedBy.status ?? 'active',
                            }}
                        />
                    ) : null}
                    Account: {claimedBy?.accountName || 'Another account'}
                </span>
            ) : state === 'gone' ? (
                <span className="inline-flex shrink-0 items-center rounded-full border border-border/40 bg-muted/20 px-2 py-0.5 text-[11px] font-medium text-muted-foreground/70">
                    Removed on Nuvio
                </span>
            ) : (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border/40 bg-muted/30 px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors group-hover:border-border/70 group-hover:text-foreground">
                    Add as account
                </span>
            )}
        </button>
    )
}
