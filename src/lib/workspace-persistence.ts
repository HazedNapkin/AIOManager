import localforage from 'localforage'

// Route localforage calls to a separate IndexedDB database for each workspace.

export const WORKSPACE_DB_PREFIX = 'aiom-ws-'
export const ANON_WORKSPACE_ID = 'anon'

// Keep the legacy database available for one-time migration.
export const LEGACY_DB_NAME = 'localforage'
export const LEGACY_MIGRATED_FLAG = 'aiom:legacy-storage-migrated'

const SYNC_STATE_KEY = 'aioman-sync'
const SYNC_STATE_LAST_GOOD_KEY = 'aioman-sync:last-good'

export interface AsyncKV {
    getItem<T = unknown>(key: string): Promise<T | null>
    setItem(key: string, value: unknown): Promise<void>
    removeItem(key: string): Promise<void>
    keys(): Promise<string[]>
    clear(): Promise<void>
}

type LF = typeof localforage

export function sanitizeWorkspaceId(id: unknown): string {
    if (typeof id !== 'string') return ANON_WORKSPACE_ID
    return id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || ANON_WORKSPACE_ID
}

export function workspaceDbName(id: string): string {
    return WORKSPACE_DB_PREFIX + sanitizeWorkspaceId(id)
}

// Read the workspace id before importing stores.
export function resolveWorkspaceIdFromSnapshot(...snapshots: Array<string | null | undefined>): string {
    for (const raw of snapshots) {
        if (!raw) continue
        try {
            const parsed = JSON.parse(raw) as { state?: { auth?: { id?: unknown } } }
            const id = parsed?.state?.auth?.id
            if (typeof id === 'string' && id) return sanitizeWorkspaceId(id)
        } catch { /* corrupt snapshot: try the next source */ }
    }
    return ANON_WORKSPACE_ID
}

function workspaceIdFromStorage(): string {
    if (typeof localStorage === 'undefined') return ANON_WORKSPACE_ID
    try {
        return resolveWorkspaceIdFromSnapshot(localStorage.getItem(SYNC_STATE_KEY), localStorage.getItem(SYNC_STATE_LAST_GOOD_KEY))
    } catch {
        return ANON_WORKSPACE_ID
    }
}

export function kvFromLocalforage(instance: LF): AsyncKV {
    return {
        getItem: key => instance.getItem(key),
        setItem: async (key, value) => { await instance.setItem(key, value) },
        removeItem: key => instance.removeItem(key),
        keys: () => instance.keys(),
        clear: () => instance.clear(),
    }
}

export function createLegacyStore(): LF {
    return localforage.createInstance({ name: LEGACY_DB_NAME, storeName: 'keyvaluepairs' })
}

type StoreFactory = (dbName: string) => AsyncKV
let storeFactory: StoreFactory = dbName => kvFromLocalforage(localforage.createInstance({ name: dbName, storeName: 'keyvaluepairs' }))

export function setWorkspaceStoreFactory(factory: StoreFactory): void {
    storeFactory = factory
}

let activeWorkspaceId = ANON_WORKSPACE_ID
const workspaceStores = new Map<string, AsyncKV>()

export function getActiveWorkspaceId(): string {
    return activeWorkspaceId
}

export function getActivePersistence(): AsyncKV {
    return workspaceStoreFor(activeWorkspaceId)
}

function workspaceStoreFor(id: string): AsyncKV {
    const key = sanitizeWorkspaceId(id)
    let store = workspaceStores.get(key)
    if (!store) {
        store = storeFactory(workspaceDbName(key))
        workspaceStores.set(key, store)
    }
    return store
}

// Switch persistence before identity transitions dispatch any storage work.
export function setActiveWorkspace(id: string): void {
    const next = sanitizeWorkspaceId(id)
    if (next === activeWorkspaceId) return
    activeWorkspaceId = next
    workspaceStoreFor(next)
}

const FORWARDED_METHODS = ['getItem', 'setItem', 'removeItem', 'clear', 'keys'] as const

// Existing localforage consumers share these workspace-aware forwarders.
export function installWorkspaceForwarders(): void {
    for (const method of FORWARDED_METHODS) {
        const forwarder = (...args: unknown[]): unknown => {
            const target = getActivePersistence() as unknown as Record<string, (...callArgs: unknown[]) => unknown>
            return target[method](...args)
        }
        ;(localforage as unknown as Record<string, unknown>)[method] = forwarder
    }
}

// Claim legacy data for one workspace before copying. Retry partial copies for that owner,
// preserving existing values; delete originals only after every key is covered.
export async function migrateLegacyIntoWorkspace(legacy: AsyncKV, workspace: AsyncKV, workspaceId: string): Promise<number> {
    const claimed = await legacy.getItem<string>(LEGACY_MIGRATED_FLAG)
    if (typeof claimed === 'string' && claimed && claimed !== workspaceId) return 0

    const legacyKeys = (await legacy.keys()).filter(key => key !== LEGACY_MIGRATED_FLAG)
    if (legacyKeys.length === 0) {
        await legacy.setItem(LEGACY_MIGRATED_FLAG, workspaceId)
        return 0
    }
    if (!claimed) {
        await legacy.setItem(LEGACY_MIGRATED_FLAG, workspaceId)
    }

    const existing = new Set(await workspace.keys())
    let copied = 0
    let failed = 0
    for (const key of legacyKeys) {
        if (existing.has(key)) continue
        try {
            const value = await legacy.getItem(key)
            if (value === null || value === undefined) continue
            await workspace.setItem(key, value)
            copied += 1
        } catch (error) {
            failed += 1
            console.warn(`[Workspace] Legacy key ${key} was not migrated:`, error)
        }
    }
    // Keep originals after a partial copy so the next boot can retry.
    if (failed === 0) {
        for (const key of legacyKeys) {
            try { await legacy.removeItem(key) } catch { /* retried on the next boot via the claim */ }
        }
    }
    return copied
}

export async function initWorkspacePersistence(): Promise<void> {
    installWorkspaceForwarders()
    setActiveWorkspace(workspaceIdFromStorage())
    try {
        const legacy = kvFromLocalforage(createLegacyStore())
        await migrateLegacyIntoWorkspace(legacy, getActivePersistence(), getActiveWorkspaceId())
    } catch (error) {
        console.warn('[Workspace] Legacy storage migration skipped:', error)
    }
}
