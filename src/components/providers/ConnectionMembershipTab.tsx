import { ExternalLink } from 'lucide-react'
import type { PremiumStatus } from '@/lib/stremio-premium'
import type { NuvioMemberStatus } from '@/lib/nuvio-tier'

const formatPremiumUntil = (expiresAt: number) =>
    new Date(expiresAt).toLocaleDateString('en', { month: 'short', year: 'numeric' })

// Stremio supporter purple + Nuvio tier gradients, both lifted from the sites' own CSS
// (stremio-colors primaryvariant1 token; nuvio.tv/support membership-plan-name rules).
const STREMIO_SUPPORTER_PURPLE = '#a970cd'
const NUVIO_TIER_STYLE: Record<string, { tint: string; gradient: string; fallback: string }> = {
    supporter: {
        tint: 'rgba(212,132,61,0.15)',
        gradient: 'linear-gradient(100deg,#d4843d,#ffde90 50%,#d4843d)',
        fallback: '#d4843d',
    },
    'supporter-plus': {
        tint: 'rgba(145,168,255,0.15)',
        gradient: 'linear-gradient(100deg,#91a8ff,#f08bd8 52%,#ff9b8e 78%,#91a8ff)',
        fallback: '#91a8ff',
    },
}

export function StremioSupportersBadge() {
    return (
        <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
            style={{ backgroundColor: `${STREMIO_SUPPORTER_PURPLE}26`, color: STREMIO_SUPPORTER_PURPLE }}
        >
            <svg viewBox="0 0 512 512" className="h-2.5 w-2.5 shrink-0" fill="currentColor" aria-hidden="true">
                <path d="M357.31 34.95c31.48.58 61.33 14.44 83.38 38.34l1.04 1.14h.01l1.03 1.17c21.42 24.39 33.28 56.72 33.29 90.23l.01 1.58c.44 135.21-99.51 228.9-199.13 302.63-6.12 4.53-13.43 6.99-20.94 6.99-7.56 0-14.85-2.47-20.96-7-100-74.01-200.35-167.96-199.1-304.2 0-34.05 12.24-66.88 34.32-91.41 22.15-24.62 52.47-38.89 84.44-39.47h.35c41.21 0 71.32 22.27 90.25 42.79 4.01 4.33 7.57 8.64 10.71 12.77 3.14-4.13 6.7-8.44 10.69-12.77 18.94-20.52 49.04-42.79 90.26-42.79z" />
            </svg>
            Supporters
        </span>
    )
}

export function NuvioTierBadge({ member }: { member: NuvioMemberStatus }) {
    const tierStyle = NUVIO_TIER_STYLE[member.tier]
    if (!tierStyle) {
        return (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                {member.label}
            </span>
        )
    }
    return (
        <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
            style={{ backgroundColor: tierStyle.tint }}
        >
            <span
                style={{
                    color: tierStyle.fallback,
                    backgroundImage: tierStyle.gradient,
                    WebkitBackgroundClip: 'text',
                    backgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                }}
            >
                {member.label}
            </span>
        </span>
    )
}

function ManageLink({ href, label }: { href: string; label: string }) {
    return (
        <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 w-fit items-center gap-1.5 rounded-xl border border-border/40 bg-card px-2.5 text-xs font-medium text-muted-foreground shadow-sm transition-colors hover:bg-muted/50 hover:text-foreground"
        >
            {label}
            <ExternalLink className="h-3.5 w-3.5" />
        </a>
    )
}

function StremioMembership({ premium }: { premium: PremiumStatus | undefined }) {
    const detail = premium === undefined
        ? 'Status unavailable'
        : !premium.active
            ? 'Free account'
            : premium.lifetime
                ? 'Lifetime member'
                : premium.expiresAt != null
                    ? `Supporter until ${formatPremiumUntil(premium.expiresAt)}`
                    : 'Active supporter'
    return (
        <div className="rounded-2xl border border-border/40 bg-card/50 p-4 shadow-sm space-y-3">
            <div className="min-w-0">
                <p className="text-sm font-semibold">Stremio membership</p>
                <p className="text-xs text-muted-foreground">Supporter status for this Stremio account.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                {premium?.active ? (
                    <StremioSupportersBadge />
                ) : premium !== undefined && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                        Free
                    </span>
                )}
                <p className="text-xs text-muted-foreground">{detail}</p>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground/80">
                Supporters get dedicated profiles, skip intro/outro, downloads, catalog organization and appearance customization.
            </p>
            <ManageLink href="https://www.stremio.com/acc-settings" label="Manage subscription" />
        </div>
    )
}

function NuvioMembership({ nuvioMember }: { nuvioMember: NuvioMemberStatus | undefined }) {
    const detail = nuvioMember === undefined
        ? 'Status unavailable'
        : nuvioMember.expiresAt != null
            ? `until ${formatPremiumUntil(nuvioMember.expiresAt)}`
            : nuvioMember.label
    const perks = nuvioMember?.tier === 'supporter-plus'
        ? 'Gradient themes, profile backgrounds, avatar collection, badge, Discord role, feature voting and the Plus role.'
        : nuvioMember?.tier === 'supporter'
            ? 'Gradient themes, profile backgrounds, avatar collection, badge and a Discord role.'
            : 'Supporting Nuvio unlocks gradient themes, profile backgrounds, avatar collection, a badge and a Discord role.'
    return (
        <div className="rounded-2xl border border-border/40 bg-card/50 p-4 shadow-sm space-y-3">
            <div className="min-w-0">
                <p className="text-sm font-semibold">Nuvio membership</p>
                <p className="text-xs text-muted-foreground">Membership tier for this Nuvio connection.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                {nuvioMember && <NuvioTierBadge member={nuvioMember} />}
                <p className="text-xs text-muted-foreground">{detail}</p>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground/80">
                {perks}
            </p>
            <ManageLink href="https://nuvio.tv/support" label="Manage membership" />
        </div>
    )
}

export function ConnectionMembershipTab({ platform, premium, nuvioMember }: {
    platform: string
    premium?: PremiumStatus
    nuvioMember?: NuvioMemberStatus
}) {
    if (platform === 'stremio') return <StremioMembership premium={premium} />
    if (platform === 'nuvio') return <NuvioMembership nuvioMember={nuvioMember} />
    return null
}
