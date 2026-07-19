export function normalizeManifestUrl(url: string): string {
    return url.toLowerCase().replace(/\/+$/, '')
}

export function generateInstanceId(existingPresets: unknown[]): string {
    const existingIds = new Set(
        existingPresets
            .filter((p): p is { instanceId: string } => 
                p !== null && 
                typeof p === 'object' && 
                'instanceId' in p && 
                typeof p.instanceId === 'string'
            )
            .map(p => p.instanceId.toLowerCase())
    )
    
    for (let attempt = 0; attempt < 10; attempt++) {
        const id = Math.floor(Math.random() * 4096).toString(16).padStart(3, '0').slice(-3)
        if (!existingIds.has(id)) {
            return id
        }
    }
    
    return Math.floor(Math.random() * 4096).toString(16).padStart(3, '0').slice(-3)
}

export function buildCustomPreset(name: string, manifestUrl: string, instanceId: string) {
    return {
        type: 'custom',
        instanceId,
        enabled: true,
        options: {
            name,
            manifestUrl,
            timeout: 20000,
            resources: [],
            mediaTypes: [],
            libraryAddon: false,
            resultPassthrough: false
        }
    }
}

export function presetManifestExists(config: Record<string, unknown>, manifestUrl: string): boolean {
    const presets = config.presets
    if (!Array.isArray(presets)) {
        return false
    }
    
    const normalizedTarget = normalizeManifestUrl(manifestUrl)
    
    for (const preset of presets) {
        if (preset !== null && typeof preset === 'object' && 'options' in preset) {
            const options = preset.options
            if (options !== null && typeof options === 'object' && 'manifestUrl' in options && typeof options.manifestUrl === 'string') {
                const normalized = normalizeManifestUrl(options.manifestUrl)
                if (normalized === normalizedTarget) {
                    return true
                }
            }
        }
    }
    
    return false
}

export function injectAddonIntoAIOStreams(config: Record<string, unknown>, preset: object): Record<string, unknown> {
    const cloned = JSON.parse(JSON.stringify(config)) as Record<string, unknown>
    
    if (!Array.isArray(cloned.presets)) {
        cloned.presets = []
    }

    (cloned.presets as unknown[]).push(preset)
    
    return cloned
}

export async function performInjection(
    baseUrl: string,
    uuid: string,
    password: string,
    name: string,
    manifestUrl: string
): Promise<{ success: boolean; alreadyExists: boolean; error?: string }> {
    try {
        const { fetchAIOStreamsUser, updateAIOStreamsUser, sanitizeAIOStreamsConfigForUpdate } = await import('./aiostreams-utils')
        const { userData } = await fetchAIOStreamsUser(baseUrl, uuid, password)
        
        if (presetManifestExists(userData, manifestUrl)) {
            return { success: true, alreadyExists: true }
        }
        
        const presets = Array.isArray(userData.presets) ? userData.presets : []
        const instanceId = generateInstanceId(presets)
        const preset = buildCustomPreset(name, manifestUrl, instanceId)
        const updatedConfig = injectAddonIntoAIOStreams(userData, preset)
        const sanitized = sanitizeAIOStreamsConfigForUpdate(updatedConfig)
        
        await updateAIOStreamsUser(baseUrl, uuid, password, sanitized)
        
        return { success: true, alreadyExists: false }
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, alreadyExists: false, error: message }
    }
}