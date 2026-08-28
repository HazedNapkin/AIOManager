export interface DeviceRecord {
    accountUUID: string
    deviceId: string
    deviceSecret?: Uint8Array
    credentialId?: string
    blob: Uint8Array
    createdAt: string
    expiresAt: string
    label: string
}

const DB_NAME = 'aio-device'
const DB_VERSION = 1
const STORE = 'devices'
const LOCK_PREFIX = 'aio-device:'

export type DeviceDbFactory = Pick<typeof indexedDB, 'open'>

let dbPromise: Promise<IDBDatabase> | null = null
let dbFactory: DeviceDbFactory | null = null

export function setDeviceDbFactoryForTests(factory: DeviceDbFactory | null): void {
    dbFactory = factory
    dbPromise = null
}

function resolveFactory(): DeviceDbFactory | null {
    if (dbFactory) return dbFactory
    try {
        return typeof indexedDB !== 'undefined' ? indexedDB : null
    } catch {
        return null
    }
}

function openDb(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise
    const factory = resolveFactory()
    if (!factory) return Promise.reject(new Error('IndexedDB is not available'))
    dbPromise = new Promise((resolve, reject) => {
        const request = factory.open(DB_NAME, DB_VERSION)
        request.onupgradeneeded = () => {
            const db = request.result
            if (!db.objectStoreNames.contains(STORE)) {
                db.createObjectStore(STORE, { keyPath: 'accountUUID' })
            }
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('Failed to open aio-device database'))
        request.onblocked = () => reject(new Error('aio-device database is blocked by another tab'))
    })
    return dbPromise
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
    })
}

async function withStore<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => Promise<T>
): Promise<T> {
    const db = await openDb()
    const tx = db.transaction(STORE, mode)
    const result = await run(tx.objectStore(STORE))
    await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
    })
    return result
}

async function withLock<T>(accountUUID: string, run: () => Promise<T>): Promise<T> {
    const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined
    if (!locks?.request) return run()
    return locks.request(LOCK_PREFIX + accountUUID, { mode: 'exclusive' }, () => run()) as Promise<T>
}

function toRecord(stored: unknown): DeviceRecord | null {
    if (!stored || typeof stored !== 'object') return null
    const raw = stored as Partial<DeviceRecord>
    const hasSecret = raw.deviceSecret instanceof Uint8Array
    const hasCredential = typeof raw.credentialId === 'string' && raw.credentialId.length > 0
    if (
        typeof raw.accountUUID !== 'string' ||
        typeof raw.deviceId !== 'string' ||
        !(hasSecret || hasCredential) ||
        !(raw.blob instanceof Uint8Array) ||
        typeof raw.createdAt !== 'string' ||
        typeof raw.expiresAt !== 'string'
    ) {
        return null
    }
    return {
        accountUUID: raw.accountUUID,
        deviceId: raw.deviceId,
        deviceSecret: hasSecret ? raw.deviceSecret : undefined,
        credentialId: hasCredential ? raw.credentialId : undefined,
        blob: raw.blob,
        createdAt: raw.createdAt,
        expiresAt: raw.expiresAt,
        label: typeof raw.label === 'string' ? raw.label : '',
    }
}

export function isRecordExpired(record: DeviceRecord): boolean {
    const expiry = Date.parse(record.expiresAt)
    return !Number.isFinite(expiry) || Date.now() >= expiry
}

const TERMINAL_AUTH_REASONS = new Set(['revoked', 'expired', 'generation'])

export function isTerminalAuthReason(reason: unknown): boolean {
    return typeof reason === 'string' && TERMINAL_AUTH_REASONS.has(reason)
}

export async function saveRecord(record: DeviceRecord): Promise<void> {
    await withLock(record.accountUUID, async () => {
        await withStore('readwrite', async (store) => {
            const keys = (await requestToPromise(store.getAllKeys())) as IDBValidKey[]
            const removals = keys.filter((key) => key !== record.accountUUID).map((key) => requestToPromise(store.delete(key)))
            await Promise.all(removals)
            await requestToPromise(store.put(record))
        })
    })
}

export async function getRecord(accountUUID: string): Promise<DeviceRecord | null> {
    const stored = await withStore('readonly', (store) => requestToPromise(store.get(accountUUID)))
    return toRecord(stored)
}

export async function getAnyRecord(): Promise<DeviceRecord | null> {
    const stored = await withStore('readonly', async (store) => {
        const keys = (await requestToPromise(store.getAllKeys())) as IDBValidKey[]
        if (keys.length === 0) return undefined
        return requestToPromise(store.get(keys[0]))
    })
    return toRecord(stored)
}

export async function deleteRecord(accountUUID: string): Promise<void> {
    await withLock(accountUUID, () => withStore('readwrite', (store) => requestToPromise(store.delete(accountUUID))))
}

export async function wipeDeviceRecords(): Promise<void> {
    await withStore('readwrite', (store) => requestToPromise(store.clear()))
}
