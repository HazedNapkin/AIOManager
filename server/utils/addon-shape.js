export function normalizeHydraAddonInput(raw) {
    if (!raw || typeof raw !== 'object') return null
    const m = raw.manifest ?? raw
    return {
        transportUrl: raw.transportUrl || raw.url || '',
        manifest: {
            id: m.id || raw.id || '',
            name: m.name || raw.name || '',
            version: m.version || raw.version || '',
            logo: m.logo || raw.logo || '',
            types: m.types || raw.types || [],
            resources: m.resources || raw.resources || []
        },
        flags: { enabled: (raw.flags?.enabled ?? raw.enabled) !== false }
    }
}
