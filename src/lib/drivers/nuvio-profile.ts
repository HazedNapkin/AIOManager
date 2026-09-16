// Pure Nuvio profile resolution, split from the drivers so the fallback semantics are
// unit-testable without a fetch stub. The drivers own the RPC; this owns the decision.
//
// The pairing rule for refusals: a self-hosted backend has no sync_pull_profiles RPC - it
// can't enumerate profiles, so treat it as single-profile and write to the primary. Refuse
// only when profiles were enumerated and the stored id matches none: that's a genuine
// wrong-target write.

export type ConnectionStatusLite = 'active' | 'expired' | 'error' | 'degraded' | 'pending'

export interface ProfileResolutionOptions {
    strict?: boolean
}

export interface ProfileResolutionResult {
    index: number
    profilesRpcFailed: boolean
}

export async function resolveProfileIndexWith(
    pullProfiles: () => Promise<Array<Record<string, unknown>>>,
    profileId: string | number | undefined,
    opts: ProfileResolutionOptions = {},
): Promise<ProfileResolutionResult> {
    if (typeof profileId === 'number' && Number.isFinite(profileId) && profileId > 0) {
        return { index: profileId, profilesRpcFailed: false }
    }
    const stringId = String(profileId || '').trim()
    if (/^\d+$/.test(stringId)) return { index: parseInt(stringId, 10), profilesRpcFailed: false }

    let profiles: Array<Record<string, unknown>> = []
    let profilesRpcFailed = false
    try {
        profiles = await pullProfiles()
    } catch {
        profilesRpcFailed = true
    }

    if (Array.isArray(profiles) && stringId) {
        const match = profiles.find(p => p.id === stringId)
        if (match) {
            const idx = (match.profile_index ?? match.profileIndex) as number
            if (Number.isFinite(idx) && idx > 0) return { index: idx, profilesRpcFailed }
        }
    }

    if (opts.strict && stringId && !profilesRpcFailed) {
        const err = new Error('Could not resolve the Nuvio profile to write; refusing to fall back to the primary profile') as Error & { status?: number }
        err.status = 404
        throw err
    }

    if (!Array.isArray(profiles) || profiles.length === 0) return { index: 1, profilesRpcFailed }

    const primary = profiles.find(p => (p.profile_index ?? p.profileIndex) === 1)
    if (primary) return { index: 1, profilesRpcFailed }

    const first = profiles[0]
    const fallbackIdx = (first.profile_index ?? first.profileIndex) as number
    if (Number.isFinite(fallbackIdx) && fallbackIdx > 0) return { index: fallbackIdx, profilesRpcFailed }
    return { index: 1, profilesRpcFailed }
}
