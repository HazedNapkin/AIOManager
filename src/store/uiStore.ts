import { triggerSync } from '@/lib/sync-trigger'
import { Account } from '@/types/account'
import { create } from 'zustand'

interface UIStore {
  isAddAccountDialogOpen: boolean
  isAddAddonDialogOpen: boolean

  isPrivacyModeEnabled: boolean
  privacyLevelNames: number
  privacyLevelUrls: number
  privacyLevelProfiles: number
  liveActivity: boolean
  isWhatsNewOpen: boolean
  libraryViewMode: 'grid' | 'list'
  accountsView: 'grid' | 'list'
  addonListView: 'grid' | 'list'

  openAddAccountDialog: (account?: Account) => void
  closeAddAccountDialog: () => void
  openAddAddonDialog: (accountId: string) => void
  closeAddAddonDialog: () => void

  setWhatsNewOpen: (open: boolean) => void
  togglePrivacyMode: () => void
  setPrivacyOption: (key: 'privacyLevelNames' | 'privacyLevelUrls' | 'privacyLevelProfiles', value: number) => void
  setLiveActivity: (value: boolean) => void
  setLibraryViewMode: (mode: 'grid' | 'list') => void
  setAccountsView: (mode: 'grid' | 'list') => void
  setAddonListView: (mode: 'grid' | 'list') => void
  initialize: () => void
  editingAccount: Account | null
  selectedAccountId: string | null
}

const PRIVACY_MODE_KEY = 'aioman:privacy-mode'
const PRIVACY_LEVEL_NAMES_KEY = 'aioman:privacy-level-names'
const PRIVACY_LEVEL_URLS_KEY = 'aioman:privacy-level-urls'
const PRIVACY_LEVEL_PROFILES_KEY = 'aioman:privacy-level-profiles'
const LIVE_ACTIVITY_KEY = 'aioman:live-activity'

function migratePrivacyLevel(newKey: string, oldKey: string): number {
    try {
        const stored = localStorage.getItem(newKey)
        if (stored !== null) return parseInt(stored, 10) || 0
        const oldBool = localStorage.getItem(oldKey)
        if (oldBool !== null) {
            const level = oldBool === 'true' ? 2 : 0
            localStorage.setItem(newKey, String(level))
            localStorage.removeItem(oldKey)
            return level
        }
        return 0
    } catch { return 0 }
}
const VIEW_MODE_KEY = 'aioman:library-view-mode'
const ACCOUNTS_VIEW_KEY = 'aioman:accounts-view'
const ADDON_LIST_VIEW_KEY = 'aioman:addon-list-view'

const syncSettings = () => {
  triggerSync()
}

export const useUIStore = create<UIStore>((set, get) => ({
  isAddAccountDialogOpen: false,
  isAddAddonDialogOpen: false,

  isPrivacyModeEnabled: (() => {
    try {
      const stored = localStorage.getItem(PRIVACY_MODE_KEY)
      return stored !== null ? JSON.parse(stored) : false
    } catch { return false }
  })(),
  privacyLevelNames: (() => migratePrivacyLevel(PRIVACY_LEVEL_NAMES_KEY, 'aioman:privacy-obscure-names'))(),
  privacyLevelUrls: (() => migratePrivacyLevel(PRIVACY_LEVEL_URLS_KEY, 'aioman:privacy-obscure-urls'))(),
  privacyLevelProfiles: (() => migratePrivacyLevel(PRIVACY_LEVEL_PROFILES_KEY, 'aioman:privacy-obscure-profiles'))(),
  liveActivity: (() => {
    try { return localStorage.getItem(LIVE_ACTIVITY_KEY) === 'true' } catch { return false }
  })(),
  isWhatsNewOpen: false,
  libraryViewMode: (() => {
    try {
      const stored = localStorage.getItem(VIEW_MODE_KEY)
      return stored === 'grid' || stored === 'list' ? stored as 'grid' | 'list' : 'grid'
    } catch { return 'grid' }
  })(),
  accountsView: (() => {
    try {
      const stored = localStorage.getItem(ACCOUNTS_VIEW_KEY)
      return stored === 'grid' || stored === 'list' ? stored as 'grid' | 'list' : 'grid'
    } catch { return 'grid' }
  })(),
  addonListView: (() => {
    try {
      const stored = localStorage.getItem(ADDON_LIST_VIEW_KEY)
      return stored === 'grid' || stored === 'list' ? stored as 'grid' | 'list' : 'grid'
    } catch { return 'grid' }
  })(),

  editingAccount: null,
  selectedAccountId: null,

  openAddAccountDialog: (account?: Account) =>
    set({ isAddAccountDialogOpen: true, editingAccount: account || null }),
  closeAddAccountDialog: () => set({ isAddAccountDialogOpen: false, editingAccount: null }),
  openAddAddonDialog: (accountId: string) =>
    set({ isAddAddonDialogOpen: true, selectedAccountId: accountId }),
  closeAddAddonDialog: () => set({ isAddAddonDialogOpen: false, selectedAccountId: null }),

  setWhatsNewOpen: (open: boolean) => set({ isWhatsNewOpen: open }),
  togglePrivacyMode: () => {
    const newValue = !get().isPrivacyModeEnabled
    set({ isPrivacyModeEnabled: newValue })
    localStorage.setItem(PRIVACY_MODE_KEY, JSON.stringify(newValue))
    syncSettings()
  },
  setPrivacyOption: (key, value) => {
    set({ [key]: value } as Partial<UIStore>)
    const storageMap = {
      privacyLevelNames: PRIVACY_LEVEL_NAMES_KEY,
      privacyLevelUrls: PRIVACY_LEVEL_URLS_KEY,
      privacyLevelProfiles: PRIVACY_LEVEL_PROFILES_KEY,
    }
    localStorage.setItem(storageMap[key], String(value))
    syncSettings()
  },
  setLiveActivity: (value) => {
    set({ liveActivity: value })
    localStorage.setItem(LIVE_ACTIVITY_KEY, String(value))
  },
  setLibraryViewMode: (mode) => {
    set({ libraryViewMode: mode })
    localStorage.setItem(VIEW_MODE_KEY, mode)
    syncSettings()
  },
  setAccountsView: (mode) => {
    set({ accountsView: mode })
    localStorage.setItem(ACCOUNTS_VIEW_KEY, mode)
    syncSettings()
  },
  setAddonListView: (mode) => {
    set({ addonListView: mode })
    localStorage.setItem(ADDON_LIST_VIEW_KEY, mode)
    syncSettings()
  },
  initialize: () => {
    // Privacy mode and viewMode are now eagerly loaded at store creation.
    // No-op: retained for backward compat
  },
}))
