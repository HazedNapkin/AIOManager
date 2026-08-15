const MIGRATION_KEY = 'aioman:storage-migrated'

const KEY_MAP: Record<string, string> = {
    'stremio-manager-theme': 'aioman-theme',
    'stremio-manager:user-salt': 'aioman:user-salt',
    'stremio-manager:password-hash': 'aioman:password-hash',
    'stremio-manager:session-key': 'aioman:session-key',
    'stremio-manager:privacy-mode': 'aioman:privacy-mode',
    'stremio-manager:library-view-mode': 'aioman:library-view-mode',
    'stremio-manager:accounts-view': 'aioman:accounts-view',
    'stremio-manager:addon-list-view': 'aioman:addon-list-view',
    'stremio-manager:hide-disabled-addons': 'aioman:hide-disabled-addons',
    'stremio-manager:addon-preview-count': 'aioman:addon-preview-count',
    'stremio-manager:manifest-cache': 'aioman:manifest-cache',
    'stremio-manager:failover-rules': 'aioman:failover-rules',
    'stremio-manager:failover-rules:webhook': 'aioman:failover-rules:webhook',
    'stremio-manager:failover-deleted': 'aioman:failover-deleted',
    'stremio-manager:failover-history': 'aioman:failover-history',
    'stremio-manager:profiles': 'aioman:profiles',
    'stremio-manager:key-vault': 'aioman:key-vault',
    'stremio-manager:latest-versions': 'aioman:latest-versions',
    'stremio-manager:account-addons': 'aioman:account-addons',
    'stremio-manager:addon-library': 'aioman:addon-library',
    'stremio-manager:accounts': 'aioman:accounts',
    'stremio-manager:accounts:backup': 'aioman:accounts:backup',
    'stremio-manager:changelog': 'aioman:changelog',
    'stremio-manager-sync': 'aioman-sync',
}

const LOCALFORAGE_KEYS = [
    'stremio-manager:failover-rules',
    'stremio-manager:failover-rules:webhook',
    'stremio-manager:failover-deleted',
    'stremio-manager:failover-history',
    'stremio-manager:profiles',
    'stremio-manager:key-vault',
    'stremio-manager:latest-versions',
    'stremio-manager:account-addons',
    'stremio-manager:addon-library',
    'stremio-manager:accounts',
    'stremio-manager:accounts:backup',
    'stremio-manager:changelog',
    'stremio-manager:manifest-cache',
]

export function migrateLocalStorageKeys(): boolean {
    if (typeof window === 'undefined') return true
    if (localStorage.getItem(MIGRATION_KEY)) return true

    let allSucceeded = true
    for (const [oldKey, newKey] of Object.entries(KEY_MAP)) {
        try {
            const value = localStorage.getItem(oldKey)
            if (value !== null && localStorage.getItem(newKey) === null) {
                localStorage.setItem(newKey, value)
                localStorage.removeItem(oldKey)
            }
        } catch (error) {
            console.warn(`Failed to migrate localStorage key ${oldKey} to ${newKey}:`, error)
            allSucceeded = false
        }
    }
    
    return allSucceeded
}

export async function migrateLocalforageKeys(): Promise<void> {
    if (typeof window === 'undefined') return
    if (localStorage.getItem(MIGRATION_KEY)) return

    const localStorageSuccess = migrateLocalStorageKeys()
    
    try {
        const { default: localforage } = await import('localforage')
        let localforageSuccess = true
        
        for (const oldKey of LOCALFORAGE_KEYS) {
            try {
                const value = await localforage.getItem(oldKey)
                if (value !== null) {
                    const newKey = KEY_MAP[oldKey]
                    if (newKey && (await localforage.getItem(newKey)) === null) {
                        await localforage.setItem(newKey, value)
                        await localforage.removeItem(oldKey)
                    }
                }
            } catch (error) {
                console.warn(`Failed to migrate localforage key ${oldKey} to ${KEY_MAP[oldKey] || '(unknown)'}:`, error)
                localforageSuccess = false
            }
        }
        
        if (localStorageSuccess && localforageSuccess) {
            try {
                localStorage.setItem(MIGRATION_KEY, '1')
            } catch (error) {
                console.warn('Failed to set migration flag:', error)
            }
        }
    } catch (error) {
        console.warn('Failed to load localforage:', error)
    }
}
