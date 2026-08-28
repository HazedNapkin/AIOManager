// Profile Quick-Add orchestrator (spec docs/profile-quick-add-spec.md).
//
// Client-only. Turns Nuvio profiles / Stremio Supporters profiles into
// first-class AIOManager accounts.
//
// Hard rules enforced here:
// 1. A FRESH Nuvio session is authenticated per profile via /api/providers/
//    nuvio/auth. Source-connection tokens are never copied between accounts:
//    Nuvio refresh-token rotation would invalidate every sibling.
// 2. profileId is always the numeric profile_index as a string. Resolving a
//    string id upstream silently falls back to profile 1 = cross-profile data
//    bleed, so the numeric index travels end to end.
// 3. One account per profile, never a second same-platform connection on one
//    account: every profile creates its own account row.
// 4. Stored expiresAt jitters backwards by 0-30 minutes per connection so
//    batch-created siblings do not refresh against Supabase in lockstep.
// 5. A claim-guard rerun skips profiles another live account already picked up.

import { useAccountStore, persistAccounts } from '../accountStore'
import { useConnectionStore } from '../connectionStore'
import { nuvioAuth } from '@/api/hydra-providers'
import { triggerSync } from '@/lib/sync-trigger'
import { getProfileClaims, profileClaimKey } from '@/lib/profile-claims'

export const PROFILE_EXPIRY_JITTER_MAX_MS = 30 * 60 * 1000

export interface ProfileQuickAddEntry {
    /** Numeric Nuvio profile slot (hard rule 2) — never a resolved string id. */
    profileIndex: number
    name: string
    /** Inherited from the platform profile where available. */
    avatarColorHex?: string
}

export interface ProfileQuickAddResult {
    entry: ProfileQuickAddEntry
    accountId: string | null
    ok: boolean
    skipped: boolean
    error?: string
}

export interface ProfileQuickAddOutcome {
    results: ProfileQuickAddResult[]
    succeeded: number
    failed: number
}

/** Subtracts a random 0..30min offset so sibling sessions desync their refreshes. */
export function jitterExpiresAt(expiresAt: number, rng: () => number = Math.random): number {
    const jittered = expiresAt - Math.floor(rng() * (PROFILE_EXPIRY_JITTER_MAX_MS + 1))
    return Math.max(jittered, Date.now())
}

const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

export function parseAccentColorHex(value?: string): string | undefined {
    if (!value) return undefined
    const trimmed = value.trim()
    if (!HEX_COLOR_RE.test(trimmed)) return undefined
    return trimmed
}

function findSourceNuvioConnection(sourceAccountId: string) {
    const source = useAccountStore.getState().accounts.find(a => a.id === sourceAccountId)
    const connection = source?.connections?.find(c => c.platform === 'nuvio')
    if (!source || !connection) throw new Error('Could not find the Nuvio login for this account.')
    return connection
}

export async function findAccountByAuthKey(authKey: string): Promise<string | null> {
    const { getStremioAuthKey, getCachedAuthKey } = await import('../accountStore')
    const { useAuthStore } = await import('@/store/authStore')
    const encKey = useAuthStore.getState().encryptionKey
    if (!encKey) return null
    for (const account of useAccountStore.getState().accounts) {
        const encrypted = getStremioAuthKey(account)
        if (!encrypted) continue
        try {
            const stored = await getCachedAuthKey(encrypted, encKey)
            if (stored === authKey) return account.id
        } catch { continue }
    }
    return null
}

/**
 * Adds each selected Nuvio profile as its own fully managed account.
 * Runs strictly sequentially (auth rate limit + honest progress), continues
 * past individual failures, then triggers exactly one sync.
 */
export async function addNuvioProfiles(
    sourceAccountId: string,
    email: string,
    password: string,
    entries: ProfileQuickAddEntry[],
): Promise<ProfileQuickAddOutcome> {
    if (!email || !password) throw new Error('Nuvio email and password are required to add profiles.')
    const connection = findSourceNuvioConnection(sourceAccountId)
    // Backend identity comes from the source login's stored credentials:
    // every sibling profile lands on the same backend.
    const baseUrl = connection.credentials?.baseUrl || undefined
    const publishableKey = connection.credentials?.publishableKey || undefined

    const results: ProfileQuickAddResult[] = []

    for (const entry of entries) {
        try {
            // Hard rule 2: numeric index only, coerced at the last responsible moment.
            const profileIndex = Number(entry.profileIndex)
            if (!Number.isInteger(profileIndex) || profileIndex < 0) {
                throw new Error('Profile has no usable slot index')
            }

            // Decision 4 claim guard: a same-device rerun must not double-add.
            const claims = getProfileClaims(useAccountStore.getState().accounts)
            if (claims.has(profileClaimKey({ platform: 'nuvio', profileId: String(profileIndex), baseUrl }))) {
                results.push({ entry, accountId: null, ok: false, skipped: true, error: 'Already added' })
                continue
            }

            // Hard rule 1: fresh session per profile, auth endpoint only.
            const { tokens } = await nuvioAuth(email, password, publishableKey, baseUrl)

            // Pattern mirrors AccountStore.addLocalAccount (accountStore.ts:740).
            const accountId = await useAccountStore.getState().addLocalAccount(
                entry.name,
                parseAccentColorHex(entry.avatarColorHex),
            )

            try {
                await useConnectionStore.getState().addConnection(accountId, {
                    platform: 'nuvio',
                    connectionType: 'native',
                    enabled: true,
                    status: 'active',
                    capabilities: ['addons', 'plugins', 'profiles'],
                    credentials: {
                        accessToken: tokens.accessToken,
                        refreshToken: tokens.refreshToken,
                        expiresAt: String(jitterExpiresAt(tokens.expiresAt)),
                        // Hard rule 2, always: numeric index preserved as string.
                        profileId: String(profileIndex),
                        ...(baseUrl ? { baseUrl } : {}),
                        ...(publishableKey ? { publishableKey } : {}),
                        ...(email ? { email } : {}),
                    },
                })
            } catch (connError) {
                // A bare local account with no connection is an orphan the claim
                // guard cannot see; remove it so a retry starts clean.
                await useAccountStore.getState().removeAccount(accountId).catch(() => {})
                throw connError
            }

            results.push({ entry, accountId, ok: true, skipped: false })
        } catch (error) {
            results.push({
                entry,
                accountId: null,
                ok: false,
                skipped: false,
                error: error instanceof Error ? error.message : 'Could not add this profile.',
            })
        }
    }

    persistAccounts(useAccountStore.getState().accounts)
    triggerSync()

    return {
        results,
        succeeded: results.filter(r => r.ok).length,
        failed: results.filter(r => !r.ok && !r.skipped).length,
    }
}

/**
 * Wraps AccountStore.addAccountByAuthKey for Stremio Supporters profiles.
 * Returns the created account id; an "already added" duplicate guard hit
 * surfaces as a skip instead of a failure.
 */
export async function addStremioProfileAccount(
    authKey: string,
    name: string,
    accentColor?: string,
): Promise<{ accountId: string | null; skipped: boolean }> {
    const knownIds = new Set(useAccountStore.getState().accounts.map(a => a.id))
    try {
        await useAccountStore.getState().addAccountByAuthKey(authKey, name, accentColor)
    } catch (error) {
        const message = error instanceof Error ? error.message : ''
        if (/already added/i.test(message)) {
            // The skip path still resolves the owning account: the caller needs it
            // to stamp the profile claim that a partial first attempt may have missed.
            const existing = await findAccountByAuthKey(authKey)
            return { accountId: existing, skipped: true }
        }
        throw error
    }
    const created = useAccountStore.getState().accounts.find(a => !knownIds.has(a.id))
    return { accountId: created?.id ?? null, skipped: false }
}
