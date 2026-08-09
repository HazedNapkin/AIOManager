import { triggerSync } from '@/lib/sync-trigger'
import { Profile } from '@/types/profile'
import localforage from 'localforage'
import { create } from 'zustand'

const STORAGE_KEY = 'aioman:profiles'
const DELETED_KEY = 'aioman:deleted-profiles'

interface ProfileState {
    profiles: Profile[]
    loading: boolean
    error: string | null

    initialize: () => Promise<void>
    createProfile: (name: string, description?: string, color?: string) => Promise<Profile>
    updateProfile: (id: string, updates: Partial<Omit<Profile, 'id' | 'createdAt'>>) => Promise<void>
    deleteProfile: (id: string) => Promise<void>
    reorderProfiles: (newOrder: Profile[]) => Promise<void>
    getProfile: (id: string) => Profile | undefined
    importProfiles: (profiles: Profile[]) => Promise<void>
    reset: () => void
}

export const useProfileStore = create<ProfileState>((set, get) => ({
    profiles: [],
    loading: false,
    error: null,

    initialize: async () => {
        set({ loading: true })
        try {
            const stored = await localforage.getItem<Profile[]>(STORAGE_KEY)
            if (stored) {
                const parsed = stored.map(p => ({
                    ...p,
                    createdAt: new Date(p.createdAt),
                    updatedAt: new Date(p.updatedAt)
                }))
                set({ profiles: parsed })
            }
        } catch (err) {
            if (import.meta.env.DEV) console.error('Failed to load profiles:', err)
            set({ error: 'Failed to load profiles' })
        } finally {
            set({ loading: false })
        }
    },

    createProfile: async (name: string, description?: string, color?: string) => {
        const newProfile: Profile = {
            id: crypto.randomUUID(),
            name,
            description,
            color,
            createdAt: new Date(),
            updatedAt: new Date()
        }

        const updated = [...get().profiles, newProfile]
        try {
            await localforage.setItem(STORAGE_KEY, updated)
        } catch (err) {
            if (import.meta.env.DEV) console.error('[ProfileStore] Failed to persist createProfile:', err)
            throw new Error('Failed to save profile. Please try again.')
        }
        set({ profiles: updated, error: null })
        triggerSync()

        return newProfile
    },

    updateProfile: async (id: string, updates: Partial<Omit<Profile, 'id' | 'createdAt'>>) => {
        const updated = get().profiles.map(p =>
            p.id === id
                ? { ...p, ...updates, updatedAt: new Date() }
                : p
        )
        try {
            await localforage.setItem(STORAGE_KEY, updated)
        } catch (err) {
            if (import.meta.env.DEV) console.error('[ProfileStore] Failed to persist updateProfile:', err)
            throw new Error('Failed to save profile. Please try again.')
        }
        set({ profiles: updated, error: null })
        triggerSync()
    },

    deleteProfile: async (id: string) => {
        const updated = get().profiles.filter(p => p.id !== id)
        try {
            await localforage.setItem(STORAGE_KEY, updated)
            const deleted = await localforage.getItem<string[]>(DELETED_KEY) || []
            if (!deleted.includes(id)) {
                deleted.push(id)
                await localforage.setItem(DELETED_KEY, deleted)
            }
        } catch (err) {
            if (import.meta.env.DEV) console.error('[ProfileStore] Failed to persist deleteProfile:', err)
            throw new Error('Failed to delete profile. Please try again.')
        }
        set({ profiles: updated, error: null })
        triggerSync()
    },

    reorderProfiles: async (newOrder: Profile[]) => {
        try {
            await localforage.setItem(STORAGE_KEY, newOrder)
        } catch (err) {
            if (import.meta.env.DEV) console.error('[ProfileStore] Failed to persist reorderProfiles:', err)
            throw new Error('Failed to save profile order. Please try again.')
        }
        set({ profiles: newOrder, error: null })
        triggerSync()
    },

    getProfile: (id: string) => {
        return get().profiles.find(p => p.id === id)
    },

    importProfiles: async (profilesToImport: Profile[]) => {
        const existingIds = new Set(get().profiles.map(p => p.id))
        let deletedIds: string[] = []
        try {
            deletedIds = await localforage.getItem<string[]>(DELETED_KEY) || []
        } catch {}
        const deletedSet = new Set(deletedIds)
        const newProfiles = profilesToImport.filter(p => !existingIds.has(p.id) && !deletedSet.has(p.id))

        if (newProfiles.length === 0) return

        const updated = [...get().profiles, ...newProfiles]
        try {
            await localforage.setItem(STORAGE_KEY, updated)
        } catch (err) {
            if (import.meta.env.DEV) console.error('[ProfileStore] Failed to persist importProfiles:', err)
            throw new Error('Failed to import profiles. Please try again.')
        }
        set({ profiles: updated, error: null })
        triggerSync()
    },

    reset: () => {
        set({ profiles: [], loading: false, error: null })
        localforage.removeItem(STORAGE_KEY)
    }
}))
