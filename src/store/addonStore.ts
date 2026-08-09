import { triggerSync } from '@/lib/sync-trigger'
import { fetchAddonManifest } from '@/api/addons'
import { identifyAddon } from '@/lib/addon-identifier'
import { checkAllAddonsHealth } from '@/lib/addon-health'
import { getAddonVersionKey, normalizeAddonUrl } from '@/lib/utils'
import {
  loadAccountAddonStates,
  loadAddonLibrary,
  saveAccountAddonStates,
  saveAddonLibrary,
} from '@/lib/addon-storage'
import { normalizeTagName } from '@/lib/addon-validator'

import { useAccountStore, type ReplaceTransportUrlResult } from '@/store/accountStore'
import { AddonManifest, AddonDescriptor } from '@/types/addon'
import type { Account } from '@/types/account'
import { getEffectiveManifest } from '@/lib/addon-utils'
import {
  AccountAddonState,
  BulkResult,
  MergeResult,
  SavedAddon,
  SavedAddonManifestChangeSummary,
  SavedAddonManifestUpdateResult,
} from '@/types/saved-addon'
import { create } from 'zustand'
import localforage from 'localforage'
import { restorationManager } from '@/lib/autopilot/restorationManager'
import type { CloneMode } from '@/lib/clone-mode'

import { applySavedAddonToAccount, applySavedAddonToAccounts, applyTagToAccount, applyTagToAccounts, bulkApplySavedAddons, bulkApplyTag, bulkRemoveAddons, bulkRemoveByTag, bulkReinstallAddons, bulkInstallFromUrls, bulkReplaceUrl, bulkCloneAccount, bulkSyncOrder, bulkReinstallAllOnAccount, syncAccountState, syncAllAccountStates, replaceTransportUrlUniversally } from './addon/addonDeployment'
import { updateSavedAddonManifest } from './addon/addonManifest'

export const _outboundSyncInProgress = new Set<string>()

const BACKOFF_STORAGE_KEY = 'aio:self-repair-backoff'
const SELF_REPAIR_COOLDOWN_MS = 60 * 60 * 1000

const selfRepairBackoff = {
  _cache: new Map<string, number>(),
  _load() {
    try {
      const raw = sessionStorage.getItem(BACKOFF_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, number>
        const now = Date.now()
        for (const [k, v] of Object.entries(parsed)) {
          if (now - v < SELF_REPAIR_COOLDOWN_MS) this._cache.set(k, v)
        }
        this._flush()
      }
    } catch {
      return
    }
  },
  _flush() {
    try {
      const obj: Record<string, number> = {}
      for (const [k, v] of this._cache) obj[k] = v
      sessionStorage.setItem(BACKOFF_STORAGE_KEY, JSON.stringify(obj))
    } catch {
      return
    }
  },
  get(key: string): number | undefined { return this._cache.get(key) },
  set(key: string, ts: number) { this._cache.set(key, ts); this._flush() },
  delete(key: string) { this._cache.delete(key); this._flush() },
}
selfRepairBackoff._load()

let _saveDebounceTimer: ReturnType<typeof setTimeout> | null = null

export const _saveLibraryDebounced = (getState: () => AddonStore) => {
  if (_saveDebounceTimer) clearTimeout(_saveDebounceTimer)
  _saveDebounceTimer = setTimeout(async () => {
    try {
      await saveAddonLibrary(getState().library)
      _saveDebounceTimer = null
    } catch (err) {
      if (import.meta.env.DEV) console.error('[AddonStore] Debounced save failed:', err)
    }
  }, 500)
}

export interface AddonStore {
  library: Record<string, SavedAddon>
  latestVersions: Record<string, string>
  manifestChangeHints: Record<string, SavedAddonManifestChangeSummary>
  accountStates: Record<string, AccountAddonState>
  loading: boolean
  isUpdatingAddon: boolean
  error: string | null
  checkingHealth: boolean

  initialize: () => Promise<void>

  updateLatestVersions: (versions: Record<string, string>) => void
  updateManifestChangeHints: (hints: Record<string, SavedAddonManifestChangeSummary>) => void
  getLatestVersion: (manifestId: string) => string | undefined

  createSavedAddon: (
    name: string,
    installUrl: string,
    tags?: string[],
    profileId?: string,
    existingManifest?: AddonManifest,
    metadata?: SavedAddon['metadata'],
    catalogOverrides?: SavedAddon['catalogOverrides']
  ) => Promise<string>
  updateSavedAddon: (
    id: string,
    updates: Partial<Pick<SavedAddon, 'name' | 'tags' | 'installUrl' | 'syncWithInstalled' | 'manifest'>> & { profileId?: string | null; metadata?: SavedAddon['metadata'] }
  ) => Promise<void>
  updateSavedAddonMetadata: (
    id: string,
    metadata: Record<string, unknown>,
    skipOutbound?: boolean
  ) => Promise<void>
  bulkUpdateSavedAddons: (
    ids: string[],
    updates: Partial<Pick<SavedAddon, 'tags' | 'profileId' | 'syncWithInstalled'>> & { tagsRemove?: string[] }
  ) => Promise<void>
  bulkDeleteSavedAddons: (ids: string[]) => Promise<void>
  updateSavedAddonManifest: (id: string) => Promise<SavedAddonManifestUpdateResult>
  deleteSavedAddon: (id: string) => Promise<void>
  deleteSavedAddonsByProfile: (profileId: string) => Promise<void>
  getSavedAddon: (id: string) => SavedAddon | null

  getSavedAddonsByTag: (tag: string) => SavedAddon[]
  getAllTags: () => string[]
  renameTag: (oldTag: string, newTag: string) => Promise<void>

  applySavedAddonToAccount: (
    savedAddonId: string,
    accountId: string,
    accountAuthKey: string
  ) => Promise<MergeResult>
  applySavedAddonToAccounts: (
    savedAddonId: string,
    accountIds: Array<{ id: string; authKey: string }>
  ) => Promise<BulkResult>

  applyTagToAccount: (
    tag: string,
    accountId: string,
    accountAuthKey: string
  ) => Promise<MergeResult>
  applyTagToAccounts: (
    tag: string,
    accountIds: Array<{ id: string; authKey: string }>
  ) => Promise<BulkResult>
  importAccountStates: (states: Record<string, AccountAddonState>) => Promise<void>

  bulkApplySavedAddons: (
    savedAddonIds: string[],
    accountIds: Array<{ id: string; authKey: string }>,
    allowProtected?: boolean
  ) => Promise<BulkResult>
  bulkApplyTag: (
    tag: string,
    accountIds: Array<{ id: string; authKey: string }>
  ) => Promise<BulkResult>
  bulkRemoveAddons: (
    addonIds: string[],
    accountIds: Array<{ id: string; authKey: string }>,
    allowProtected?: boolean
  ) => Promise<BulkResult>
  bulkRemoveByTag: (
    tag: string,
    accountIds: Array<{ id: string; authKey: string }>,
    allowProtected?: boolean
  ) => Promise<BulkResult>
  bulkReinstallAddons: (
    addonIds: string[],
    accountIds: Array<{ id: string; authKey: string }>,
    allowProtected?: boolean,
    onProgress?: (current: number, total: number) => void
  ) => Promise<BulkResult>
  bulkInstallFromUrls: (
    urls: string[],
    accountIds: Array<{ id: string; authKey: string }>,
    allowProtected?: boolean
  ) => Promise<BulkResult>
  bulkReplaceUrl: (
    find: string,
    replace: string,
    accountIds: Array<{ id: string; authKey: string }>
  ) => Promise<BulkResult>
  bulkCloneAccount: (
    sourceAccount: { id: string; authKey: string },
    targetAccountIds: Array<{ id: string; authKey: string }>,
    overwrite?: boolean,
    cloneMode?: CloneMode
  ) => Promise<BulkResult>
  bulkSyncOrder: (
    sourceAccountId: string,
    targetAccountIds: Array<{ id: string; authKey: string }>
  ) => Promise<BulkResult>
  bulkReinstallAllOnAccount: (accountId: string, accountAuthKey: string) => Promise<BulkResult>

  syncAccountState: (accountId: string, accountAuthKey: string, addons?: AddonDescriptor[]) => Promise<void>
  syncAllAccountStates: (accounts: Account[]) => Promise<void>
  toggleAutoRestore: (id: string, enabled: boolean) => Promise<void>
  lastHealthCheck?: number

  exportLibrary: () => string
  importLibrary: (json: string | Record<string, unknown>, merge: boolean, isSilent?: boolean, isImmediate?: boolean) => Promise<void>

  checkAllHealth: () => Promise<void>
  updateHealthStatus: (statuses: Array<{ id: string; isOnline: boolean }>) => Promise<void>

  clearError: () => void
  reset: () => Promise<void>
  deleteAccountState: (accountId: string) => Promise<void>
  repairLibrary: () => Promise<void>
  setAddonSyncToLibrary: (accountId: string, transportUrl: string, value: boolean) => Promise<void>
  replaceTransportUrlUniversally: (savedAddonId: string | null, oldUrl: string, newUrl: string, accountId?: string, descriptor?: AddonDescriptor) => Promise<ReplaceTransportUrlResult>
}

export const useAddonStore = create<AddonStore>((set, get) => ({
  library: {},
  latestVersions: {},
  manifestChangeHints: {},
  accountStates: {},
  loading: false,
  isUpdatingAddon: false,
  error: null,
  checkingHealth: false,
  lastHealthCheck: undefined,

  deleteAccountState: async (accountId) => {
    const accountStates = { ...get().accountStates }
    if (accountStates[accountId]) {
      delete accountStates[accountId]
      set({ accountStates })
      await saveAccountAddonStates(accountStates)
    }
  },

  initialize: async () => {
    try {
      const [library, accountStates, latestVersions] = await Promise.all([
        loadAddonLibrary(),
        loadAccountAddonStates(),
        localforage.getItem<Record<string, string>>('aioman:latest-versions'),
      ])

      set({
        library,
        accountStates,
        latestVersions: latestVersions || {},
      })

      ;(async () => {
        const broken = Object.values(library).filter(addon =>
          !addon.manifest ||
          (addon.manifest as unknown as Record<string, unknown>).error === true ||
          addon.manifest.id?.startsWith('pending-sync-') ||
          !addon.manifest.name ||
          !addon.manifest.resources ||
          addon.manifest.version === '0.0.0'
        )
        if (broken.length === 0) return

        if (import.meta.env.DEV) console.log(`[AddonStore] Self-repair: ${broken.length} addons with missing/broken manifests`)
        let repaired = 0
        for (let i = 0; i < broken.length; i += 3) {
          await Promise.allSettled(broken.slice(i, i + 3).map(async (addon) => {
            const lastFailure = selfRepairBackoff.get(addon.installUrl)
            if (lastFailure && (Date.now() - lastFailure < SELF_REPAIR_COOLDOWN_MS)) return
            try {
              const descriptor = await fetchAddonManifest(addon.installUrl, 'Self-Repair')
              const freshManifest = identifyAddon(addon.installUrl, descriptor.manifest)
              set(state => ({
                library: {
                  ...state.library,
                  [addon.id]: {
                    ...state.library[addon.id],
                    manifest: getEffectiveManifest({ ...state.library[addon.id], manifest: freshManifest }),
                    updatedAt: new Date(),
                  },
                },
              }))
              selfRepairBackoff.delete(addon.installUrl)
              repaired++
            } catch (e) {
              selfRepairBackoff.set(addon.installUrl, Date.now())
              if (import.meta.env.DEV) console.warn(`[Self-Repair] Failed for ${addon.name || addon.installUrl}:`, e)
            }
          }))
        }
        if (repaired > 0) {
          await saveAddonLibrary(get().library)
          if (import.meta.env.DEV) console.log(`[AddonStore] Self-repair complete: ${repaired} manifests fixed`)
        }
      })()
    } catch (error) {
      if (import.meta.env.DEV) console.error('Failed to initialize addon store:', error)
      set({ error: 'Failed to load addon data' })
    }
  },

  repairLibrary: async () => {
    const library = { ...get().library }
    let hasChanges = false
    let fixedCount = 0

    for (const id in library) {
      const addon = { ...library[id] }
      if (typeof addon.profileId === 'object' && addon.profileId !== null) {
        if (import.meta.env.DEV) console.warn(`[Rescue] Found corrupted profileId for addon ${addon.name}. Removing it.`)
        delete (addon as unknown as Record<string, unknown>).profileId
        library[id] = addon
        hasChanges = true
        fixedCount++
      }
    }

    if (hasChanges) {
      set({ library })
      _saveLibraryDebounced(get)
      if (import.meta.env.DEV) console.log(`[Rescue] Successfully rescued ${fixedCount} addons from the abyss!`)
      triggerSync()
    }
  },

  setAddonSyncToLibrary: async (accountId, transportUrl, value) => {
    const { accountStates } = get()
    const newAccountStates = { ...accountStates }
    const accountState = newAccountStates[accountId]

    if (!accountState) return

    let targetFound = false
    const updatedInstalledAddons = accountState.installedAddons.map(addon => {
      if (addon.installUrl === transportUrl) {
        targetFound = true
        return { ...addon, syncToLibrary: value }
      }
      return addon
    })

    if (!targetFound) return

    newAccountStates[accountId] = {
      ...accountState,
      installedAddons: updatedInstalledAddons,
      lastSync: new Date()
    }

    if (value) {
      Object.keys(newAccountStates).forEach(otherAccountId => {
        if (otherAccountId === accountId) return

        const otherState = newAccountStates[otherAccountId]
        let otherChanged = false
        const otherUpdatedAddons = otherState.installedAddons.map(addon => {
          if (addon.installUrl === transportUrl && addon.syncToLibrary) {
            otherChanged = true
            return { ...addon, syncToLibrary: false }
          }
          return addon
        })

        if (otherChanged) {
          newAccountStates[otherAccountId] = {
            ...otherState,
            installedAddons: otherUpdatedAddons,
            lastSync: new Date()
          }
        }
      })
    }

    set({ accountStates: newAccountStates })
    await saveAccountAddonStates(newAccountStates)
  },

  updateLatestVersions: (versions) => {
    const merged = { ...get().latestVersions, ...versions }

    const { accounts } = useAccountStore.getState()
    const library = get().library

    const liveIds = new Set<string>()
    for (const account of accounts) {
      for (const addon of account.addons) {
        if (addon.manifest?.id) {
          liveIds.add(addon.manifest.id)
          liveIds.add(getAddonVersionKey(addon))
        }
      }
    }
    for (const savedAddon of Object.values(library)) {
      if (savedAddon.manifest?.id) {
        liveIds.add(savedAddon.manifest.id)
        liveIds.add(getAddonVersionKey({
          transportUrl: savedAddon.installUrl,
          manifest: savedAddon.manifest,
        }))
      }
    }

    const pruned: Record<string, string> = {}
    for (const [id, version] of Object.entries(merged)) {
      if (liveIds.has(id)) pruned[id] = version
    }

    set({ latestVersions: pruned })
    localforage.setItem('aioman:latest-versions', pruned).catch(e => { if (import.meta.env.DEV) console.error(e) })
  },

  updateManifestChangeHints: (hints) => {
    set({ manifestChangeHints: hints })
  },

  getLatestVersion: (manifestId) => {
    return get().latestVersions[manifestId]
  },

  createSavedAddon: async (name, installUrl, tags = [], profileId, existingManifest, metadata, catalogOverrides) => {
    set({ loading: true, error: null })
    try {
      let manifest = (existingManifest as unknown as Record<string, unknown> & { manifest?: AddonManifest })?.manifest || existingManifest

      if (!manifest) {
        const addonDescriptor = await fetchAddonManifest(installUrl, 'System-Check')
        manifest = getEffectiveManifest({ ...addonDescriptor, catalogOverrides })
      }

      const normalizedTags = tags.map(normalizeTagName).filter(Boolean)

      let addonName = name.trim()
      if (!addonName || addonName === 'Unknown Addon') {
        const identified = identifyAddon(installUrl, manifest || undefined)
        addonName = identified.name
        if (!manifest) manifest = identified
      }


      const normUrl = normalizeAddonUrl(installUrl)
      const existingAddon = Object.values(get().library).find(
        (addon) => normalizeAddonUrl(addon.installUrl) === normUrl
      )

      if (existingAddon) {
        if (existingAddon.profileId === profileId) {
          return existingAddon.id
        }
      }

      const savedAddon: SavedAddon = {
        id: crypto.randomUUID(),
        name: addonName,
        installUrl,
        manifest,
        originalManifest: manifest,
        tags: normalizedTags,
        profileId,
        metadata,
        catalogOverrides,
        autoRestore: false,
        syncWithInstalled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        sourceType: 'manual',
      }

      const library = { ...get().library, [savedAddon.id]: savedAddon }
      set({ library })
      _saveLibraryDebounced(get)

      triggerSync()

      return savedAddon.id
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create saved addon'
      set({ error: message })
      throw error
    } finally {
      set({ loading: false })
    }
  },

  updateSavedAddon: async (id, updates) => {
    set({ isUpdatingAddon: true, error: null })
    try {
      const savedAddon = get().library[id]
      if (!savedAddon) {
        throw new Error('Saved addon not found')
      }

      const updatedSavedAddon = { ...savedAddon }

      if (updates.name !== undefined) {
        updatedSavedAddon.name = updates.name.trim()
        updatedSavedAddon.metadata = {
          ...(updatedSavedAddon.metadata || {}),
          customName: updatedSavedAddon.name
        }
      }
      if (updates.tags !== undefined) {
        updatedSavedAddon.tags = updates.tags.map(normalizeTagName).filter(Boolean)
      }
      if (updates.profileId !== undefined) {
        updatedSavedAddon.profileId = updates.profileId || undefined
      }
      if (updates.syncWithInstalled !== undefined) {
        updatedSavedAddon.syncWithInstalled = updates.syncWithInstalled
      }

      if (updates.manifest !== undefined) {
        updatedSavedAddon.manifest = updates.manifest
      }

      if (updates.installUrl && updates.installUrl !== savedAddon.installUrl && (updates.syncWithInstalled ?? savedAddon.syncWithInstalled)) {
        if (import.meta.env.DEV) console.log(`[AddonStore] Outbound Sync: Updating all accounts for "${savedAddon.name}" due to library URL change.`)
        await get().replaceTransportUrlUniversally(id, savedAddon.installUrl, updates.installUrl)
        return
      }

      if (updates.metadata !== undefined) {
        updatedSavedAddon.metadata = { ...updatedSavedAddon.metadata, ...updates.metadata }
        if (updates.metadata.customName) {
          updatedSavedAddon.name = updates.metadata.customName
        }
      }

      updatedSavedAddon.updatedAt = new Date()

      const hasMetadataChanges = updates.metadata !== undefined || (updates.name !== undefined && updates.name !== savedAddon.name)
      if ((updates.syncWithInstalled ?? savedAddon.syncWithInstalled) && hasMetadataChanges) {
        _outboundSyncInProgress.add(id)
        try {
          if (import.meta.env.DEV) console.log(`[AddonStore] Outbound Sync: Propagating library state for "${savedAddon.name}" to all accounts.`)
          const { useAccountStore } = await import('./accountStore')
          await useAccountStore.getState().replaceTransportUrl(
            updatedSavedAddon.installUrl,
            updatedSavedAddon.installUrl,
            undefined,
            updatedSavedAddon.manifest,
            updatedSavedAddon.metadata
          )
        } finally {
          _outboundSyncInProgress.delete(id)
        }
      }

      const library = { ...get().library, [id]: updatedSavedAddon }
      set({ library })
      if (updates.syncWithInstalled !== undefined) {
        await saveAddonLibrary(library)
      } else {
        _saveLibraryDebounced(get)
      }
      triggerSync()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update saved addon'
      set({ error: message })
      throw error
    } finally {
      set({ isUpdatingAddon: false })
    }
  },

  updateSavedAddonMetadata: async (id, metadata, skipOutbound = false) => {
    try {
      set({ isUpdatingAddon: true, error: null })
      const savedAddon = get().library[id]
      if (!savedAddon) throw new Error('Saved addon not found')

      const cleanMetadata = { ...savedAddon.metadata }
      Object.keys(metadata).forEach(key => {
        const val = (metadata as Record<string, unknown>)[key]
        if (val === undefined) {
          delete (cleanMetadata as Record<string, unknown>)[key]
        } else {
          (cleanMetadata as Record<string, unknown>)[key] = val
        }
      })

      const updatedSavedAddon = {
        ...savedAddon,
        metadata: cleanMetadata,
        name: cleanMetadata.customName || savedAddon.manifest.name,
        updatedAt: new Date()
      }

      const library = { ...get().library, [id]: updatedSavedAddon }
      set({ library })
      _saveLibraryDebounced(get)

      const hasChanged = JSON.stringify(savedAddon.metadata) !== JSON.stringify(cleanMetadata)

      if (updatedSavedAddon.syncWithInstalled && !skipOutbound && hasChanged) {
        _outboundSyncInProgress.add(id)
        try {
          if (import.meta.env.DEV) console.log(`[AddonStore] Outbound Sync: Propagating metadata update for "${savedAddon.name}" to all accounts.`)
          const { useAccountStore } = await import('./accountStore')
          await useAccountStore.getState().replaceTransportUrl(
            savedAddon.installUrl,
            savedAddon.installUrl,
            undefined,
            savedAddon.manifest,
            cleanMetadata
          )
        } finally {
          _outboundSyncInProgress.delete(id)
        }
      }

      triggerSync()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update metadata'
      set({ error: message })
      throw error
    } finally {
      set({ isUpdatingAddon: false })
    }
  },

  updateSavedAddonManifest: async (id) => {
    return updateSavedAddonManifest(id)
  },

  deleteSavedAddonsByProfile: async (profileId) => {
    const library = { ...get().library }
    let hasChanges = false

    for (const id in library) {
      if (library[id].profileId === profileId) {
        delete library[id]
        hasChanges = true
      }
    }

    if (hasChanges) {
      set({ library })
      await saveAddonLibrary(library)
      triggerSync()
    }
  },

  toggleAutoRestore: async (id, enabled) => {
    try {
      const savedAddon = get().library[id]
      if (!savedAddon) throw new Error('Saved addon not found')

      const updatedSavedAddon = {
        ...savedAddon,
        autoRestore: enabled,
        updatedAt: new Date()
      }

      const library = { ...get().library, [id]: updatedSavedAddon }
      set({ library })
      _saveLibraryDebounced(get)

      triggerSync()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to toggle auto-restore'
      set({ error: message })
      throw error
    }
  },

  deleteSavedAddon: async (id) => {
    const library = { ...get().library }
    delete library[id]
    set({ library })
    await saveAddonLibrary(library)
    triggerSync()
  },

  bulkDeleteSavedAddons: async (ids) => {
    const library = { ...get().library }
    let hasChanges = false
    ids.forEach((id) => {
      if (library[id]) {
        delete library[id]
        hasChanges = true
      }
    })

    if (hasChanges) {
      set({ library })
      await saveAddonLibrary(library)
      triggerSync()
    }
  },

  bulkUpdateSavedAddons: async (ids, updates) => {
    const { library } = get()
    const updatedLibrary = { ...library }

    let hasChanges = false
    ids.forEach((id) => {
      const addon = updatedLibrary[id]
      if (addon) {
        let newTags = addon.tags
        const existingTags = new Set(addon.tags)

        if (updates.tags) {
          updates.tags.forEach((t) => existingTags.add(t))
        }

        if ('tagsRemove' in updates && (updates as Record<string, unknown>).tagsRemove) {
          const tagsToRemove = new Set((updates as Record<string, unknown>).tagsRemove as string[])
          tagsToRemove.forEach(t => existingTags.delete(t as string))
        }

        newTags = Array.from(existingTags)

        updatedLibrary[id] = {
          ...addon,
          ...updates,
          tags: newTags,
          updatedAt: new Date(),
        }
        hasChanges = true
      }
    })

    if (hasChanges) {
      set({ library: updatedLibrary })
      await saveAddonLibrary(updatedLibrary)
      triggerSync()
    }
  },

  getSavedAddon: (id) => {
    return get().library[id] || null
  },

  getSavedAddonsByTag: (tag) => {
    const normalizedTag = normalizeTagName(tag)
    return Object.values(get().library).filter((savedAddon) =>
      savedAddon.tags.some((t) => normalizeTagName(t) === normalizedTag)
    )
  },

  getAllTags: () => {
    const seen = new Map<string, string>()
    Object.values(get().library).forEach((savedAddon) => {
      savedAddon.tags.forEach((tag) => {
        const key = tag.toLowerCase().trim()
        if (key && !seen.has(key)) seen.set(key, tag)
      })
    })
    return Array.from(seen.values()).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
  },

  renameTag: async (oldTag, newTag) => {
    const normalizedOld = normalizeTagName(oldTag)
    const normalizedNew = normalizeTagName(newTag)

    if (!normalizedNew) {
      throw new Error('Invalid new tag name')
    }

    const library = { ...get().library }
    let hasChanges = false

    for (const savedAddon of Object.values(library)) {
      const tags = [...savedAddon.tags]
      const tagIndex = tags.findIndex((t) => normalizeTagName(t) === normalizedOld)
      if (tagIndex >= 0) {
        tags[tagIndex] = normalizedNew
        library[savedAddon.id] = { ...savedAddon, tags, updatedAt: new Date() }
        hasChanges = true
      }
    }

    if (hasChanges) {
      set({ library })
      await saveAddonLibrary(library)
      triggerSync()
    }
  },

  applySavedAddonToAccount: async (savedAddonId, accountId, accountAuthKey) => {
    return applySavedAddonToAccount(savedAddonId, accountId, accountAuthKey)
  },

  applySavedAddonToAccounts: async (savedAddonId, accountIds) => {
    return applySavedAddonToAccounts(savedAddonId, accountIds)
  },

  applyTagToAccount: async (tag, accountId, accountAuthKey) => {
    return applyTagToAccount(tag, accountId, accountAuthKey)
  },

  applyTagToAccounts: async (tag, accountIds) => {
    return applyTagToAccounts(tag, accountIds)
  },

  importAccountStates: async (states: Record<string, AccountAddonState>) => {
    const currentStates = { ...get().accountStates, ...states }
    set({ accountStates: currentStates })
    await localforage.setItem('aioman:account-addons', currentStates)
  },

  bulkApplySavedAddons: async (savedAddonIds, accountIds, allowProtected?) => {
    return bulkApplySavedAddons(savedAddonIds, accountIds, allowProtected)
  },

  bulkApplyTag: async (tag, accountIds) => {
    return bulkApplyTag(tag, accountIds)
  },

  bulkRemoveAddons: async (addonIds, accountIds, allowProtected?) => {
    return bulkRemoveAddons(addonIds, accountIds, allowProtected)
  },

  bulkRemoveByTag: async (tag, accountIds, allowProtected?) => {
    return bulkRemoveByTag(tag, accountIds, allowProtected)
  },

      bulkReinstallAddons: async (addonIds, accountIds, allowProtected?, onProgress?) => {
            return bulkReinstallAddons(addonIds, accountIds, allowProtected, onProgress)
  },

  bulkInstallFromUrls: async (urls, accountIds, allowProtected?) => {
    return bulkInstallFromUrls(urls, accountIds, allowProtected)
  },

  bulkReplaceUrl: async (find, replace, accountIds) => {
    return bulkReplaceUrl(find, replace, accountIds)
  },

  bulkCloneAccount: async (sourceAccount, targetAccountIds, overwrite?, cloneMode?) => {
    return bulkCloneAccount(sourceAccount, targetAccountIds, { overwrite, cloneMode })
  },

  bulkSyncOrder: async (sourceAccountId, targetAccountIds) => {
    return bulkSyncOrder(sourceAccountId, targetAccountIds)
  },

  bulkReinstallAllOnAccount: async (accountId, accountAuthKey) => {
    return bulkReinstallAllOnAccount(accountId, accountAuthKey)
  },

  syncAccountState: async (accountId, accountAuthKey, addons?) => {
    return syncAccountState(accountId, accountAuthKey, addons)
  },

  syncAllAccountStates: async (accounts) => {
    return syncAllAccountStates(accounts)
  },

  exportLibrary: () => {
    const library = get().library
    const savedAddons = Object.values(library).map(({ originalManifest: _originalManifest, ...rest }) => rest)
    return JSON.stringify(
      {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        savedAddons,
      },
      null,
      2
    )
  },

  importLibrary: async (json, merge, isSilent = false, isImmediate = false) => {
    set({ loading: true, error: null })
    if (import.meta.env.DEV) console.log("%c[AddonStore] Importing library with SECURE HARDENING", "color: green; font-weight: bold;")
    try {
      let data: Record<string, unknown>
      if (!json) {
        data = {}
      } else if (typeof json === 'object') {
        data = json
      } else if (typeof json === 'string') {
        if (json.includes('[object Object]')) {
          console.error('Critical: Received "[object Object]" string in importLibrary. Aborting to prevent data loss.')
          throw new Error('Remote library data is corrupted (Double-encoded object). Aborting sync.')
        } else {
          try {
            data = JSON.parse(json)
          } catch (e) {
            if (import.meta.env.DEV) console.error('Failed to parse library JSON:', json ? json.substring(0, 100) : 'null')
            throw new Error('Failed to parse library data. Aborting to prevent data loss.')
          }
        }
      } else {
        data = {}
      }

      if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) {
        if (!merge) {
          set({ library: {} })
          await saveAddonLibrary({})
        }
        return
      }

      const dataRec = data as Record<string, unknown>
      let scavengedData = dataRec.savedAddons ||
        dataRec['stremio-manager:addon-library'] ||
        dataRec.templates ||
        (dataRec.addons as Record<string, unknown> | undefined)?.savedAddons ||
        (Array.isArray(data) ? data : null)

      if (scavengedData && !Array.isArray(scavengedData) && typeof scavengedData === 'object') {
        scavengedData = Object.values(scavengedData as Record<string, unknown>)
      }

      const savedAddons = scavengedData as unknown[] || []

      const manifestMap = (dataRec.manifests || (dataRec.addons as Record<string, unknown> | undefined)?.manifests || {}) as Record<string, unknown>

      if (!savedAddons || !Array.isArray(savedAddons)) {
        if (import.meta.env.DEV) console.warn('[AddonStore] No valid addon data found in import object.')
      }

      const currentLibrary: Record<string, SavedAddon> = merge ? { ...get().library } : {}

      for (const item of savedAddons) {
        const newItem = item as Record<string, unknown>
        if (!newItem.id || !newItem.installUrl) {
          if (import.meta.env.DEV) console.warn('Skipping invalid item (Missing ID or URL):', newItem)
          continue
        }

        try {
          const parsed = new URL(newItem.installUrl as string)
            if (!['http:', 'https:'].includes(parsed.protocol)) {
              if (import.meta.env.DEV) console.warn('Skipping addon with invalid URL scheme:', newItem.installUrl)
              continue
            }
        } catch {
            if (import.meta.env.DEV) console.warn('Skipping addon with invalid URL:', newItem.installUrl)
          continue
        }

        if (!newItem.manifest && newItem.manifestId && manifestMap[newItem.manifestId as string]) {
          newItem.manifest = manifestMap[newItem.manifestId as string]
        }

        if (newItem.manifest && (newItem.manifest as unknown as Record<string, unknown>).manifest) {
          newItem.manifest = (newItem.manifest as unknown as Record<string, unknown> & { manifest: AddonManifest }).manifest
        }

        if (!newItem.manifest) {
          if (import.meta.env.DEV) console.warn(`[AddonStore] Item ${newItem.name || newItem.id} is missing a manifest.Attempting recovery...`)

          if (newItem.installUrl) {
             newItem.manifest = {
              id: 'pending-sync-' + (newItem.id as string),
              name: (newItem.name as string) || 'Recovering Addon...',
              version: '0.0.0',
              description: 'Manifest is being recovered from the source URL.',
              types: [],
              resources: [],
              catalogs: []
            } as AddonManifest
          } else {
            if (import.meta.env.DEV) console.error(`[AddonStore] Skipping item ${newItem.id} - No manifest and no installUrl for recovery.`)
            continue
          }
        }

        const metadata = newItem.metadata && typeof newItem.metadata === 'object'
          ? (() => {
            const md = newItem.metadata as Record<string, unknown>
            return {
              ...(typeof md.customName === 'string' && { customName: md.customName }),
              ...(typeof md.customLogo === 'string' && { customLogo: md.customLogo }),
              ...(typeof md.customDescription === 'string' && { customDescription: md.customDescription }),
            }
          })()
          : undefined
        const catalogOverrides = newItem.catalogOverrides && typeof newItem.catalogOverrides === 'object'
          ? (() => {
            const co = newItem.catalogOverrides as Record<string, unknown>
            return {
              removed: Array.isArray(co.removed)
                ? (co.removed as unknown[]).filter((item: unknown): item is string => typeof item === 'string')
                : [],
              ...(Array.isArray(co.catalogs) && {
                catalogs: (co.catalogs as unknown[]).filter((item: unknown) =>
                  item && typeof item === 'object' &&
                  typeof (item as Record<string, unknown>).id === 'string' &&
                  typeof (item as Record<string, unknown>).type === 'string'
                ) as import('@/types/addon').Catalog[],
              }),
            }
          })()
          : undefined
        const lastUsed = newItem.lastUsed ? new Date(newItem.lastUsed as string | number) : undefined

        const sanitizedItem = {
          id: String(newItem.id),
          name: String(newItem.name || ''),
          installUrl: String(newItem.installUrl || ''),
          sourceType: (newItem.sourceType as SavedAddon['sourceType']) || 'manual',
          ...(typeof newItem.sourceAccountId === 'string' && { sourceAccountId: newItem.sourceAccountId }),
          manifest: newItem.manifest as AddonManifest,
          createdAt: newItem.createdAt ? new Date(newItem.createdAt as string | number) : new Date(),
          updatedAt: new Date(),
          ...(lastUsed && !Number.isNaN(lastUsed.getTime()) && { lastUsed }),
          tags: Array.isArray(newItem.tags) ? newItem.tags : [],
          profileId: newItem.profileId as string | undefined,
          ...(metadata && { metadata }),
          ...(catalogOverrides && { catalogOverrides }),
          ...(typeof newItem.autoRestore === 'boolean' && { autoRestore: newItem.autoRestore }),
          ...(typeof newItem.syncWithInstalled === 'boolean' && { syncWithInstalled: newItem.syncWithInstalled }),
          note: typeof newItem.note === 'string' ? newItem.note.slice(0, 10000) : undefined,
        }
        const existing = currentLibrary[newItem.id as string]
        if (existing) {
          currentLibrary[existing.id] = {
            ...existing,
            ...sanitizedItem,
            createdAt: existing.createdAt || sanitizedItem.createdAt,
          }
        } else {
          currentLibrary[newItem.id as string] = sanitizedItem
        }
      }

      set({ library: currentLibrary })

      if (isImmediate) {
        await saveAddonLibrary(currentLibrary)
      } else {
        _saveLibraryDebounced(get)
      }

      if (!isSilent) {
        triggerSync()
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to import library'
      set({ error: message })
      throw error
    } finally {
      set({ loading: false })
    }
  },

  checkAllHealth: async () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return

    const { library, checkingHealth, lastHealthCheck } = get()
    if (checkingHealth) return

    const COOLDOWN = 3 * 60 * 1000
    if (lastHealthCheck && (Date.now() - lastHealthCheck < COOLDOWN)) {
      if (import.meta.env.DEV) console.log(`[Health] Skipping checkAllHealth(Cooldown: ${Math.round((COOLDOWN - (Date.now() - lastHealthCheck)) / 1000)}s remaining)`)
      return
    }

    set({ checkingHealth: true })
    try {
      const addons = Object.values(library)
      const results = await checkAllAddonsHealth(addons)

      const updatedLibrary = { ...library }
      let hasChanges = false

      for (const result of results) {
        const addon = updatedLibrary[result.id]
        if (!addon) continue

        const isOnline = result.health?.isOnline ?? false
        const wasOnline = addon.health?.isOnline

        if (wasOnline !== isOnline) {
          updatedLibrary[result.id] = {
            ...addon,
            health: {
              isOnline,
              lastChecked: Date.now(),
            },
            updatedAt: new Date(),
          }
          hasChanges = true
        } else {
          updatedLibrary[result.id] = {
            ...addon,
            health: {
              isOnline,
              lastChecked: Date.now(),
            },
          }
        }

        if (!isOnline && addon.autoRestore) {
          if (restorationManager.canAttemptRestore(addon.installUrl, true)) {
            if (import.meta.env.DEV) console.log(`[Restoration] Attempting recovery for: ${addon.name} `)
            restorationManager.recordAttempt(addon.installUrl)

            try {
              await get().updateSavedAddonManifest(addon.id)
              restorationManager.recordSuccess(addon.installUrl)
              if (import.meta.env.DEV) console.log(`[Restoration] Successfully recovered: ${addon.name} `)
            } catch (err) {
              restorationManager.recordFailure(addon.installUrl)
              if (import.meta.env.DEV) console.warn(`[Restoration] Recovery failed for ${addon.name}: `, err)
            }
          }
        } else if (isOnline && addon.autoRestore) {
          restorationManager.recordSuccess(addon.installUrl)
        }
      }

      if (hasChanges) {
        set({ library: updatedLibrary, lastHealthCheck: Date.now() })
        saveAddonLibrary(updatedLibrary)
      } else {
        set({ lastHealthCheck: Date.now() })
      }
    } catch (error) {
      if (import.meta.env.DEV) console.error('Health check failed:', error)
    } finally {
      set({ checkingHealth: false })
    }
  },

  updateHealthStatus: async (statuses: Array<{ id: string; isOnline: boolean }>) => {
    const library = { ...get().library }
    let hasChanges = false

    statuses.forEach(({ id, isOnline }) => {
      if (library[id]) {
        if (library[id].health?.isOnline !== isOnline) {
          library[id] = {
            ...library[id],
            health: {
              isOnline,
              lastChecked: Date.now(),
            },
          }
          hasChanges = true
        } else {
          library[id] = {
            ...library[id],
            health: {
              isOnline,
              lastChecked: Date.now(),
            },
          }
        }
      }
    })

    if (hasChanges) {
      set({ library })
      _saveLibraryDebounced(get)
    }
  },

  clearError: () => set({ error: null }),

  reset: async () => {
    set({
      library: {},
      latestVersions: {},
      manifestChangeHints: {},
      accountStates: {},
      error: null,
      loading: false,
    })
    await Promise.all([
      localforage.removeItem('aioman:addon-library'),
      localforage.removeItem('aioman:account-addons'),
    ])
  },
  replaceTransportUrlUniversally: async (savedAddonId, oldUrl, newUrl, accountId, descriptor) => {
    return replaceTransportUrlUniversally(savedAddonId, oldUrl, newUrl, accountId, descriptor)
  },
}))

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (_saveDebounceTimer) {
      clearTimeout(_saveDebounceTimer)
      const state = useAddonStore.getState()
      if (Object.keys(state.library).length > 0) {
        saveAddonLibrary(state.library).catch(() => {})
      }
    }
  })
}
