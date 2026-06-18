import localforage from 'localforage'

export async function wipeAllData(): Promise<void> {
  try {
    await localforage.clear()
    if (import.meta.env.DEV) console.log('IndexedDB cleared')
  } catch (err) {
    if (import.meta.env.DEV) console.error('Failed to clear IndexedDB:', err)
  }

  try {
    localStorage.clear()
    if (import.meta.env.DEV) console.log('localStorage cleared')
  } catch (err) {
    if (import.meta.env.DEV) console.error('Failed to clear localStorage:', err)
  }

  try {
    sessionStorage.clear()
    if (import.meta.env.DEV) console.log('sessionStorage cleared')
  } catch (err) {
    if (import.meta.env.DEV) console.error('Failed to clear sessionStorage:', err)
  }
}
