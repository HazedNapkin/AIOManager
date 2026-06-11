import localforage from 'localforage'

/**
 * Wipes all application data from IndexedDB, localStorage, and sessionStorage
 * Used during master password reset
 */
export async function wipeAllData(): Promise<void> {
  // Wipe IndexedDB via LocalForage (Nuclear)
  try {
    await localforage.clear()
    if (import.meta.env.DEV) console.log('IndexedDB cleared')
  } catch (err) {
    import.meta.env.DEV && console.error('Failed to clear IndexedDB:', err)
  }

  // Wipe localStorage
  try {
    localStorage.clear()
    if (import.meta.env.DEV) console.log('localStorage cleared')
  } catch (err) {
    import.meta.env.DEV && console.error('Failed to clear localStorage:', err)
  }

  // Wipe sessionStorage
  try {
    sessionStorage.clear()
    if (import.meta.env.DEV) console.log('sessionStorage cleared')
  } catch (err) {
    import.meta.env.DEV && console.error('Failed to clear sessionStorage:', err)
  }
}
