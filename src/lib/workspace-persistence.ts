import localforage from 'localforage'

// Local persistence is namespaced per sync workspace: every workspace gets its
// own IndexedDB database and the shared default localforage instance forwards
// to the active workspace's backend. Before this, one origin-global store let
// workspace A's notes surface in workspace B on the same browser.

export const WORKSPACE_DB_PREFIX = 'aiom-ws-'
export const ANON_WORKSPACE_ID = 'anon'

// The origin-global database every pre-namespacing build wrote to (localforage's
// own default name), kept readable for the one-time migration.
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

// The persisted sync snapshot is the boot-time source of the workspace id; it is
// read raw (no store import) because this bootstrap runs before any store loads.
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

export function createWorkspaceStore(id: string): LF {
    return localforage.createInstance({ name: workspaceDbName(id), storeName: 'keyvaluepairs' })
}

export function createLegacyStore(): LF {
    return localforage.createInstance({ name: LEGACY_DB_NAME, storeName: 'keyvaluepairs' })
}

// Workspace backends are localforage instances in the app; tests swap in
// in-memory stores so the routing and migration rules run without IndexedDB.
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

// Identity transitions (login, register, logout, session wipe) call this before
// further persistence so nothing lands in another workspace's backend. Same-id
// calls are no-ops, so silent re-syncs of the current workspace skip the swap.
export function setActiveWorkspace(id: string): void {
    const next = sanitizeWorkspaceId(id)
    if (next === activeWorkspaceId) return
    activeWorkspaceId = next
    workspaceStoreFor(next)
}

// Thrown by assertActiveWorkspace when the active namespace moved on: an
// import that outlives its session must abort instead of leaking the rest of
// its writes into the next session's backend.
export class WorkspaceFenceError extends Error {
    constructor(public readonly expectedWorkspace: string, public readonly activeWorkspace: string) {
        super(`Workspace changed while writing: expected ${expectedWorkspace}, active is ${activeWorkspace}`)
        this.name = 'WorkspaceFenceError'
    }
}

export function assertActiveWorkspace(expected: string): void {
    const active = getActiveWorkspaceId()
    if (active !== expected) throw new WorkspaceFenceError(expected, active)
}

const FORWARDED_METHODS = ['getItem', 'setItem', 'removeItem', 'clear', 'keys'] as const

// Re-points the default localforage instance at the active workspace. Call sites
// all hold this singleton, so this is what makes namespacing work without
// touching them; assignment replaces any previous forwarder.
export function installWorkspaceForwarders(): void {
    for (const method of FORWARDED_METHODS) {
        const forwarder = (...args: unknown[]): unknown => {
            const target = getActivePersistence() as unknown as Record<string, (...callArgs: unknown[]) => unknown>
            return target[method](...args)
        }
        ;(localforage as unknown as Record<string, unknown>)[method] = forwarder
    }
}

// One-time read of the origin-global keys. That data belonged to whoever was
// signed in when namespacing first booted, so the claim flag lives inside the
// legacy store (localStorage is wiped on sign-out) and records its owner: a
// later workspace on the same browser never inherits another user's legacy
// keys. The claim is written before the copy (a crash mid-copy retries for the
// same owner and only fills gaps; existing namespaced values are never
// overwritten). Once every legacy key is covered the originals are deleted, so
// a deleted or cleared workspace can never resurrect stale pre-migration data
// on re-login.
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
    // Consumed only once nothing is left behind: a partial copy keeps the legacy
    // originals so the next boot can finish the job.
    if (failed === 0) {
        for (const key of legacyKeys) {
            try { await legacy.removeItem(key) } catch { /* retried on the next boot via the claim */ }
        }
    }
    return copied
}

// Boot hook: runs before the app bundle makes its first localforage call.
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
