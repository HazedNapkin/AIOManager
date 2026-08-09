import './lib/polyfill'
import { migrateLocalStorageKeys, migrateLocalforageKeys } from '@/lib/storage-migration'

window.addEventListener('unhandledrejection', (e) => {
  if (e.reason?.name === 'AbortError') {
    e.preventDefault()
  }
})

migrateLocalStorageKeys()

migrateLocalforageKeys().finally(() => {
  import('./app-entry')
})
