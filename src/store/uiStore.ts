import { triggerSync } from '@/lib/sync-trigger'
import { Account } from '@/types/account'
import { create } from 'zustand'

interface UIStore {
  isAddAccountDialogOpen: boolean
  isAddAddonDialogOpen: boolean

  isPrivacyModeEnabled: boolean
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
  setLibraryViewMode: (mode: 'grid' | 'list') => void
  setAccountsView: (mode: 'grid' | 'list') => void
  setAddonListView: (mode: 'grid' | 'list') => void
  initialize: () => void
  editingAccount: Account | null
  selectedAccountId: string | null
}

const PRIVACY_MODE_KEY = 'stremio-manager:privacy-mode'
const VIEW_MODE_KEY = 'stremio-manager:library-view-mode'
const ACCOUNTS_VIEW_KEY = 'stremio-manager:accounts-view'
const ADDON_LIST_VIEW_KEY = 'stremio-manager:addon-list-view'

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
