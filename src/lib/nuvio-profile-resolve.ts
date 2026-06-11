export function resolveNuvioPushProfile(
    conn: { credentials?: Record<string, string | undefined>; profileMapping?: Record<string, number> },
    activeProfileId?: string | null,
    tokenProfileId?: string | number | null
): string | number | undefined {
    if (activeProfileId && conn.profileMapping) {
        const mapped = conn.profileMapping[activeProfileId]
        if (Number.isFinite(mapped) && mapped > 0) return mapped
    }
    if (tokenProfileId) return tokenProfileId
    const creds = conn.credentials || {}
    return creds.profileIndex || creds.profileId || undefined
}
