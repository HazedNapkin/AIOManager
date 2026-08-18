import './lib/polyfill'
import { migrateLocalStorageKeys, migrateLocalforageKeys } from '@/lib/storage-migration'

window.addEventListener('unhandledrejection', (e) => {
  if (e.reason?.name === 'AbortError') {
    e.preventDefault()
  }
})

const CHUNK_RELOAD_KEY = 'aio:chunk-reload-ts'
window.addEventListener('vite:preloadError', (event) => {
  const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0)
  if (Date.now() - last < 30_000) return
  sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()))
  event.preventDefault()
  window.location.reload()
})

migrateLocalStorageKeys()

migrateLocalforageKeys().finally(() => {
  import('./app-entry')
})
