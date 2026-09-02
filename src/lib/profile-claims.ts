// Profile Quick-Add claim registry.
//
// Pure, client-side derivation: which platform profile is "owned" by which
// AIOManager account. Claims are scanned across ALL live accounts' connections
// at roster render and again before creation (same-device rerun guard), so
// deleting an account automatically releases its claims — there is no separate
// release step to forget (spec decision 10).
//
// Registry key contract: `${platform}|${baseUrl || 'default'}|${profileId}`.
// profileId is ALWAYS the numeric profile_index as a string for Nuvio (hard
// rule 2) and the Supporters sub-profile id for Stremio.

import type { Account } from '@/types/account'

export type ProfileRosterState = 'active-here' | 'claimed' | 'unclaimed' | 'gone'

export interface ProfileClaim {
    accountId: string
    accountName: string
    accountEmail?: string
    /** Claiming account avatar URL, if it has one. */
    avatar?: string
    emoji?: string
    status: 'active' | 'error' | 'expired'
    colorIndex?: number
    /** Connection that recorded the claim. */
    connectionId: string
}

/** Minimal roster profile shape shared by both platforms. */
export interface RosterProfile {
    platform: string
    /** Nuvio: numeric profile_index as string. Stremio: Supporters profile id. */
    profileId: string
    /** Backend scoping for Nuvio; omitted means the default backend. */
    baseUrl?: string
    /** Upstream-deleted profiles keep showing as 'gone' while an account still claims them. */
    upstreamDeleted?: boolean
}

const DEFAULT_BACKEND = 'default'
const DEFAULT_LOGIN = 'default'

/** Keep in sync with ACCOUNT_COLORS length in src/lib/utils.ts (type-only home keeps this module dependency-free). */
const ACCOUNT_COLORS_LENGTH = 10

export interface RosterProfile {
    platform: string
    /** Nuvio: numeric profile_index as string. Stremio: Supporters profile id. */
    profileId: string
    /** Backend scoping for Nuvio; omitted means the default backend. */
    baseUrl?: string
    /** Upstream-deleted profiles keep showing as 'gone' while an account still claims them. */
    upstreamDeleted?: boolean
    /** Stable per-upstream-login scope (e.g. hashed login email/auth). Profiles from
     *  different Nuvio logins must never collide, even at the same profile_index. */
    loginId?: string
}

export function profileClaimKey(profile: Pick<RosterProfile, 'platform' | 'profileId' | 'baseUrl' | 'loginId'>): string {
    return `${profile.platform}|${profile.baseUrl || DEFAULT_BACKEND}|${profile.loginId || DEFAULT_LOGIN}|${profile.profileId}`
}

/**
 * Stable scope for a platform connection's credentials: the upstream login the
 * connection belongs to. Derived profile accounts share their parent login, so
 * parent and derived resolve to the same scope; different logins never collide
 * even when their profile indexes match.
 */
export function loginScope(credentials: Record<string, unknown> | undefined | null): string {
    if (!credentials) return ''
    const c = credentials as Record<string, string>
    const identity = c.email || c.username || c.authKey || c.password || ''
    let hash = 5381
    for (let i = 0; i < identity.length; i++) hash = ((hash << 5) + hash + identity.charCodeAt(i)) >>> 0
    return hash.toString(36)
}

function normalizeProfileId(value: unknown): string {
    return String(value ?? '').trim()
}

/**
 * Scan every live account's connections and derive one claim per claimed
 * profile. Idempotent by construction: deriving from current state twice (or
 * rescanning the same account) yields the same entries; a deleted account's
 * connections simply stop existing, releasing its claims.
 */
export function getProfileClaims(accounts: Account[]): Map<string, ProfileClaim> {
    const claims = new Map<string, ProfileClaim>()

    accounts.forEach((account, index) => {
        const connections = Array.isArray(account.connections) ? account.connections : []
        for (const conn of connections) {
            const credentials = conn.credentials || {}
            if (conn.platform === 'nuvio') {
                const profileId = normalizeProfileId(credentials.profileId)
                if (!profileId) continue
                claims.set(profileClaimKey({ platform: 'nuvio', profileId, baseUrl: credentials.baseUrl, loginId: loginScope(credentials) }), {
                    accountId: account.id,
                    accountName: account.name,
                    accountEmail: account.email,
                    avatar: account.avatar || undefined,
                    emoji: account.emoji || undefined,
                    status: account.status,
                    colorIndex: index % ACCOUNT_COLORS_LENGTH,
                    connectionId: conn.id,
                })
            } else if (conn.platform === 'stremio') {
                // Supporters sub-profile identity stamped onto profile-scoped
                // accounts when they were added via Profile Quick-Add. The
                // stremioProfileId is the globally unique Stremio user id, so
                // no login scoping is needed here (unlike Nuvio's index).
                const profileId = normalizeProfileId(credentials.stremioProfileId)
                if (!profileId) continue
                claims.set(profileClaimKey({ platform: 'stremio', profileId }), {
                    accountId: account.id,
                    accountName: account.name,
                    accountEmail: account.email,
                    avatar: account.avatar || undefined,
                    emoji: account.emoji || undefined,
                    status: account.status,
                    colorIndex: index % ACCOUNT_COLORS_LENGTH,
                    connectionId: conn.id,
                })
            }
        }
    })

    return claims
}

/**
 * Resolve a roster row state from the registry.
 *
 * - 'active-here': the current account itself owns this profile.
 * - 'claimed': another live account owns it.
 * - 'unclaimed': nobody owns it (or the profile vanished upstream with no
 *   account still attached to it).
 * - 'gone': upstream-deleted profile that an account still claims (spec
 *   decision 11).
 *
 * `currentConnectionId` locates the rendering context. Ownership resolves per
 * ACCOUNT (a platform holds exactly one connection per account), so today the
 * active-here test only needs the account id; the parameter stays in the
 * contract for per-connection refinement once multi-backend backends exist on
 * one account.
 */
export function resolveProfileState(
    profile: RosterProfile,
    claims: Map<string, ProfileClaim>,
    currentAccountId: string | null | undefined,
    currentConnectionId: string | null | undefined,
): ProfileRosterState {
    void currentConnectionId

    if (!normalizeProfileId(profile.profileId)) return 'unclaimed'
    if (profile.upstreamDeleted && claims.has(profileClaimKey(profile))) return 'gone'

    const claim = claims.get(profileClaimKey(profile))
    if (!claim) return 'unclaimed'
    if (currentAccountId && claim.accountId === currentAccountId) return 'active-here'
    return 'claimed'
}
