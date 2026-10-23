// Pure derivation of the Nuvio sync-target state, shared by the picker and the
// profile manager so both read the same effective target against the same
// freshly loaded profile list.
//
// This mirrors the writer, it does not define it. Push resolution is
// lib/nuvio-profile-resolve.ts (resolveNuvioPushProfile) feeding
// lib/drivers/nuvio-profile.ts (resolveProfileIndexWith):
//   1. conn.profileMapping[account.activeProfileId] wins when mapped,
//   2. then the server-stored token profile (not visible to the UI),
//   3. then credentials.profileIndex || credentials.profileId.
// The resolved id is an index when it is digits, otherwise a profile UUID :
// so "2" must never match a profile whose UUID happens to be "2". With no
// stored target at all the driver falls back to the primary profile
// (index 1, else the first row): that default is the effective target too,
// and the delete guard protects it like an explicit one.

export interface NuvioTargetProfile {
    id: string
    index: number
    name?: string
}

export interface NuvioSyncTargetState {
    /** The profile pushes currently target, or null when none can be resolved. */
    active: NuvioTargetProfile | null
    /** True when `active` comes from the driver's primary-profile default rather than a stored target. */
    isDefault: boolean
    /** The stored target id when it matches nothing in the list, else empty. */
    danglingId: string
}

export interface NuvioSyncTargetSource {
    credentials?: Record<string, string | undefined>
    profileMapping?: Record<string, number>
    activeProfileId?: string | null
}

/**
 * The stored target id the writer's fallback chain would use, in its order:
 * mapped index first, then credentials.profileIndex before profileId.
 */
export function storedNuvioTargetId(source: NuvioSyncTargetSource): string {
    const { credentials, profileMapping, activeProfileId } = source
    if (activeProfileId && profileMapping) {
        const mapped = profileMapping[activeProfileId]
        if (Number.isFinite(mapped) && mapped > 0) return String(mapped)
    }
    const creds = credentials || {}
    return String(creds.profileIndex || creds.profileId || '').trim()
}

export function resolveNuvioSyncTarget(
    profiles: NuvioTargetProfile[],
    currentId: string | number | null | undefined,
): NuvioSyncTargetState {
    const id = String(currentId ?? '').trim()
    if (id) {
        const active = /^\d+$/.test(id)
            ? profiles.find(p => p.index === parseInt(id, 10)) ?? null
            : profiles.find(p => p.id === id) ?? null
        return active
            ? { active, isDefault: false, danglingId: '' }
            : { active: null, isDefault: false, danglingId: id }
    }
    // No stored target: the driver writes to the primary profile.
    const fallback = profiles.find(p => p.index === 1) ?? profiles[0] ?? null
    return { active: fallback, isDefault: !!fallback, danglingId: '' }
}
