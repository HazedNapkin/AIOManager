import { triggerSync } from '@/lib/sync-trigger'
import { create } from 'zustand'
import { VaultKey, VaultState } from '@/types/vault'
import { encrypt, decrypt } from '@/lib/crypto'
import { useAuthStore } from '@/store/authStore'
import localforage from 'localforage'
import { captureSyncOwnership, type SyncOwnership } from './sync-store-helpers'

const STORAGE_KEY = 'aioman:key-vault'
const TOMBSTONE_KEY = `${STORAGE_KEY}:tombstones`

let _vaultQueue: Promise<void> = Promise.resolve()

export interface VaultTombstone {
    id: string
    deletedAt: number
}

interface VaultStore extends VaultState {
    tombstones: VaultTombstone[]
    initialize: (ownership?: SyncOwnership) => Promise<void>
    addKey: (key: Omit<VaultKey, 'id' | 'updatedAt'>) => Promise<void>
    removeKey: (id: string) => Promise<void>
    updateKey: (id: string, key: Partial<VaultKey>) => Promise<void>
    moveKey: (id: string, direction: 'up' | 'down') => Promise<void>
    clearVault: () => Promise<void>
    importVault: (keys: VaultKey[], tombstones?: VaultTombstone[], ownership?: SyncOwnership) => Promise<void>
    saveFailed: boolean
    resetSaveFailed: () => void
}

function normalizeTombstones(tombstones: unknown): VaultTombstone[] {
    if (!Array.isArray(tombstones)) return []
    const merged = new Map<string, VaultTombstone>()
    for (const item of tombstones) {
        if (!item || typeof item !== 'object') continue
        const raw = item as Record<string, unknown>
        if (typeof raw.id !== 'string') continue
        const deletedAt = typeof raw.deletedAt === 'number' ? raw.deletedAt : Number(raw.deletedAt)
        if (!Number.isFinite(deletedAt)) continue
        const existing = merged.get(raw.id)
        if (!existing || deletedAt > existing.deletedAt) {
            merged.set(raw.id, { id: raw.id, deletedAt })
        }
    }
    return Array.from(merged.values())
}

export function mergeTombstones(...sets: VaultTombstone[][]): VaultTombstone[] {
    return normalizeTombstones(sets.flat())
}

async function persistTombstones(tombstones: VaultTombstone[], ownership?: SyncOwnership) {
    // The vault writes span awaits (encrypt, the keys write before this one): a
    // tombstone dispatch that outlives its session must not land in the
    // namespace that replaced it.
    ownership?.assert()
    await localforage.setItem(TOMBSTONE_KEY, tombstones)
}

export const useVaultStore = create<VaultStore>((set, get) => ({
    keys: [],
    tombstones: [],
    isLocked: true,
    loading: false,
    error: null,
    saveFailed: false,
    resetSaveFailed: () => set({ saveFailed: false }),

    initialize: async (ownership?: SyncOwnership) => {
        // Own-capture before the first read: the auth-subscriber and boot callers
        // pass no context, and a hydration caller's context must cover every
        // branch, not just the encrypted success path.
        const own = ownership ?? captureSyncOwnership()
        const { encryptionKey } = useAuthStore.getState()
        if (!encryptionKey) {
            own.assert()
            set({ isLocked: true })
            return
        }

        own.assert()
        set({ loading: true, error: null })
        try {
            const tombstones = normalizeTombstones(await localforage.getItem<VaultTombstone[]>(TOMBSTONE_KEY))
            own.assert()
            const encryptedData = await localforage.getItem<string>(STORAGE_KEY)
            own.assert()
            if (!encryptedData) {
                // The empty branch publishes the tombstones it just read: without
                // the fence a resumed initialization would hand them to the session
                // that replaced this one.
                set({ keys: [], tombstones, isLocked: false, loading: false })
                return
            }

            const decryptedData = await decrypt(encryptedData, encryptionKey)
            const keys = JSON.parse(decryptedData) as VaultKey[]
            // Sync hydration spans awaits: a workspace switch mid-read must not
            // publish this namespace's decrypted keys into the one that replaced it.
            own.assert()
            set({ keys, tombstones, isLocked: false, loading: false })
        } catch (error) {
            if (import.meta.env.DEV) console.error('Failed to initialize vault:', error)
            // A stale initialization publishes nothing, not even an error state:
            // the session that replaced it owns the store now.
            if (own.current()) set({ error: 'Failed to decrypt vault. Your keys might be corrupted or the password changed.', loading: false })
        }
    },

    addKey: (newKey) => {
        _vaultQueue = _vaultQueue.then(async () => {
            const { encryptionKey } = useAuthStore.getState()
            if (!encryptionKey) throw new Error('Session expired. Sign in again to continue.')

            const key: VaultKey = {
                ...newKey,
                id: crypto.randomUUID(),
                updatedAt: Date.now(),
            }

            const updatedKeys = [...get().keys, key]
            try {
                const encryptedData = await encrypt(JSON.stringify(updatedKeys), encryptionKey)
                await localforage.setItem(STORAGE_KEY, encryptedData)
            } catch (err) {
                if (import.meta.env.DEV) console.error('[VaultStore] Failed to persist addKey:', err)
                throw new Error('Failed to save key to vault. Please try again.')
            }

            set({ keys: updatedKeys, tombstones: get().tombstones.filter(t => t.id !== key.id), saveFailed: false })
            triggerSync()
        }).catch(() => {
            set({ saveFailed: true })
        })
        return _vaultQueue
    },

    removeKey: (id) => {
        _vaultQueue = _vaultQueue.then(async () => {
            const { encryptionKey } = useAuthStore.getState()
            if (!encryptionKey) throw new Error('Session expired. Sign in again to continue.')

            const updatedKeys = get().keys.filter((k) => k.id !== id)
            const tombstones = mergeTombstones(get().tombstones, [{ id, deletedAt: Date.now() }])
            try {
                const encryptedData = await encrypt(JSON.stringify(updatedKeys), encryptionKey)
                await localforage.setItem(STORAGE_KEY, encryptedData)
                await persistTombstones(tombstones)
            } catch (err) {
                if (import.meta.env.DEV) console.error('[VaultStore] Failed to persist removeKey:', err)
                throw new Error('Failed to remove key from vault. Please try again.')
            }

            set({ keys: updatedKeys, tombstones, saveFailed: false })
            triggerSync()
        }).catch(() => {
            set({ saveFailed: true })
        })
        return _vaultQueue
    },

    updateKey: (id, updates) => {
        _vaultQueue = _vaultQueue.then(async () => {
            const { encryptionKey } = useAuthStore.getState()
            if (!encryptionKey) throw new Error('Session expired. Sign in again to continue.')

            const updatedKeys = get().keys.map((k) =>
                k.id === id ? { ...k, ...updates, updatedAt: Date.now() } : k
            )
            try {
                const encryptedData = await encrypt(JSON.stringify(updatedKeys), encryptionKey)
                await localforage.setItem(STORAGE_KEY, encryptedData)
            } catch (err) {
                if (import.meta.env.DEV) console.error('[VaultStore] Failed to persist updateKey:', err)
                throw new Error('Failed to update key in vault. Please try again.')
            }

            set({ keys: updatedKeys, saveFailed: false })
            triggerSync()
        }).catch(() => {
            set({ saveFailed: true })
        })
        return _vaultQueue
    },

    moveKey: (id, direction) => {
        _vaultQueue = _vaultQueue.then(async () => {
            const { encryptionKey } = useAuthStore.getState()
            if (!encryptionKey) throw new Error('Session expired. Sign in again to continue.')

            const keys = [...get().keys]
            const index = keys.findIndex((k) => k.id === id)
            if (index === -1) return

            const newIndex = direction === 'up' ? index - 1 : index + 1
            if (newIndex < 0 || newIndex >= keys.length) return

            const [removed] = keys.splice(index, 1)
            keys.splice(newIndex, 0, removed)

            try {
                const encryptedData = await encrypt(JSON.stringify(keys), encryptionKey)
                await localforage.setItem(STORAGE_KEY, encryptedData)
            } catch (err) {
                if (import.meta.env.DEV) console.error('[VaultStore] Failed to persist moveKey:', err)
                throw new Error('Failed to reorder keys in vault. Please try again.')
            }

            set({ keys, saveFailed: false })
            triggerSync()
        }).catch(() => {
            set({ saveFailed: true })
        })
        return _vaultQueue
    },

    clearVault: async () => {
        const tombstones = mergeTombstones(
            get().tombstones,
            get().keys.map(key => ({ id: key.id, deletedAt: Date.now() }))
        )
        try {
            await localforage.removeItem(STORAGE_KEY)
            await persistTombstones(tombstones)
        } catch (err) {
            if (import.meta.env.DEV) console.error('[VaultStore] Failed to clear vault:', err)
            throw new Error('Failed to clear vault. Please try again.')
        }
        const { encryptionKey } = useAuthStore.getState()
        set({ keys: [], tombstones, isLocked: !encryptionKey })
        triggerSync()
    },

    importVault: async (keys, tombstones = [], ownership?: SyncOwnership) => {
        const own = ownership ?? captureSyncOwnership()
        if (import.meta.env.DEV) console.log('[VaultStore] Attempting to import vault keys. Count:', keys?.length)
        const { encryptionKey } = useAuthStore.getState()
        if (!encryptionKey) {
            if (import.meta.env.DEV) console.warn('[VaultStore] Cannot import vault while locked. Keys will be ignored.')
            return
        }

        if (!keys || !Array.isArray(keys)) {
            if (import.meta.env.DEV) console.warn('[VaultStore] Invalid keys format for import:', keys)
            return
        }

        const currentKeys = get().keys
        const mergedTombstones = mergeTombstones(get().tombstones, tombstones)
        const hasIncomingTombstones = normalizeTombstones(tombstones).length > 0
        if (keys.length === 0 && !hasIncomingTombstones && currentKeys.length > 0) {
            if (import.meta.env.DEV) console.warn('[VaultStore] Anti-wipe: refusing to import empty vault over existing keys.')
            return
        }

        const tombstoneById = new Map(mergedTombstones.map(t => [t.id, t]))
        const mergedById = new Map(currentKeys.map(k => [k.id, k]))
        for (const key of keys) {
            if (!key?.id) continue
            const deletedAt = tombstoneById.get(key.id)?.deletedAt ?? 0
            const keyUpdatedAt = typeof key.updatedAt === 'number' ? key.updatedAt : Number(key.updatedAt || 0)
            if (deletedAt >= keyUpdatedAt) continue

            const existing = mergedById.get(key.id)
            const existingUpdatedAt = existing?.updatedAt ?? 0
            if (!existing || keyUpdatedAt >= existingUpdatedAt) {
                mergedById.set(key.id, key)
            }
        }

        for (const tombstone of mergedTombstones) {
            const existing = mergedById.get(tombstone.id)
            if (existing && tombstone.deletedAt >= (existing.updatedAt || 0)) {
                mergedById.delete(tombstone.id)
            }
        }

        const mergedKeys = Array.from(mergedById.values())
        const encryptedData = await encrypt(JSON.stringify(mergedKeys), encryptionKey)
        // The encrypt spans awaits: re-verify before dispatching the ciphertext and
        // before publishing, so a mid-import switch never receives another session's
        // plaintext or ciphertext and never shows its keys. The tombstone write is
        // a separate awaited dispatch that would otherwise bind to whichever
        // namespace is live after the keys write resolves, so it is fenced too.
        own.assert()
        await localforage.setItem(STORAGE_KEY, encryptedData)
        own.assert()
        await persistTombstones(mergedTombstones, own)
        own.assert()

        set({ keys: mergedKeys, tombstones: mergedTombstones, isLocked: false })
        if (import.meta.env.DEV) console.log('[VaultStore] Vault import successful (merged', keys.length, 'keys into', mergedKeys.length, 'total).')
    }
}))

useAuthStore.subscribe((state, prevState) => {
    if (state.encryptionKey && !prevState.encryptionKey) {
        useVaultStore.getState().initialize().then(() => {
            import('@/store/providerStore').then(({ useProviderStore }) => {
                useProviderStore.getState().hydrateAndRefresh()
            })
        })
    } else if (!state.encryptionKey && prevState.encryptionKey) {
        useVaultStore.setState({ keys: [], isLocked: true })
    }
})

if (useAuthStore.getState().encryptionKey) {
    useVaultStore.getState().initialize().then(() => {
        import('@/store/providerStore').then(({ useProviderStore }) => {
            useProviderStore.getState().hydrateAndRefresh()
        })
    })
}
