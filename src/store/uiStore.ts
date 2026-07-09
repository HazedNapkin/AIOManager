import { triggerSync } from '@/lib/sync-trigger'
import { Account } from '@/types/account'
import { create } from 'zustand'

interface UIStore {
  isAddAccountDialogOpen: boolean
  isAddAddonDialogOpen: boolean

  isPrivacyModeEnabled: boolean
  privacyObscureNames: boolean
  privacyObscureUrls: boolean
  privacyObscureProfiles: boolean
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
  setPrivacyOption: (key: 'privacyObscureNames' | 'privacyObscureUrls' | 'privacyObscureProfiles', value: boolean) => void
  setLibraryViewMode: (mode: 'grid' | 'list') => void
  setAccountsView: (mode: 'grid' | 'list') => void
  setAddonListView: (mode: 'grid' | 'list') => void
  initialize: () => void
  editingAccount: Account | null
  selectedAccountId: string | null
}

const PRIVACY_MODE_KEY = 'aioman:privacy-mode'
const PRIVACY_NAMES_KEY = 'aioman:privacy-obscure-names'
const PRIVACY_URLS_KEY = 'aioman:privacy-obscure-urls'
const PRIVACY_PROFILES_KEY = 'aioman:privacy-obscure-profiles'
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
  privacyObscureNames: (() => {
    try { return localStorage.getItem(PRIVACY_NAMES_KEY) === 'true' } catch { return false }
  })(),
  privacyObscureUrls: (() => {
    try { return localStorage.getItem(PRIVACY_URLS_KEY) === 'true' } catch { return false }
  })(),
  privacyObscureProfiles: (() => {
    try { return localStorage.getItem(PRIVACY_PROFILES_KEY) === 'true' } catch { return false }
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
      privacyObscureNames: PRIVACY_NAMES_KEY,
      privacyObscureUrls: PRIVACY_URLS_KEY,
      privacyObscureProfiles: PRIVACY_PROFILES_KEY,
    }
    localStorage.setItem(storageMap[key], String(value))
    syncSettings()
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
