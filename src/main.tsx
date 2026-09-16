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

// Boot failures must never be a white screen: persist the crash, render a recovery
// screen with the error and a self-service repair, and let the user report the text.
const BOOT_ERROR_KEY = 'aio:boot-error'
let bootScreenShown = false

function showBootScreen(stage: string, error: unknown) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  try {
    localStorage.setItem(BOOT_ERROR_KEY, JSON.stringify({ at: new Date().toISOString(), stage, message }))
  } catch { /* storage itself may be the problem - the screen still renders */ }
  if (bootScreenShown) return
  bootScreenShown = true
  document.body.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0a;font-family:system-ui,sans-serif;padding:16px">
      <div style="max-width:520px;width:100%;background:#141414;border:1px solid #2a2a2a;border-radius:16px;padding:28px;color:#e5e5e5">
        <div style="text-align:center;font-size:12px;color:#888">AIOManager couldn't start</div>
        <div style="text-align:center;margin:14px 0;font-size:15px;font-weight:600">Startup failed at: ${stage}</div>
        <div style="background:#0a0a0a;border:1px solid #2a2a2a;border-radius:8px;padding:10px;font-family:monospace;font-size:11px;color:#f87171;word-break:break-all;max-height:120px;overflow:auto">${message.replace(/</g, '&lt;')}</div>
        <p style="font-size:12px;color:#888;line-height:1.5">Your data is stored safely - this screen means the app failed to start, not that anything was lost. "Repair" clears this device's saved app data (cloud data is unaffected). Sending a screenshot of the error above helps fix the cause.</p>
        <div style="display:flex;gap:8px;margin-top:16px">
          <button id="aio-boot-retry" style="flex:1;padding:10px;border-radius:10px;border:1px solid #2a2a2a;background:#1c1c1c;color:#e5e5e5;font-size:13px;font-weight:600;cursor:pointer">Retry</button>
          <button id="aio-boot-repair" style="flex:1;padding:10px;border-radius:10px;border:none;background:#2563eb;color:#fff;font-size:13px;font-weight:600;cursor:pointer">Clear site data &amp; reload</button>
        </div>
      </div>
    </div>`
  document.getElementById('aio-boot-retry')?.addEventListener('click', () => location.reload())
  document.getElementById('aio-boot-repair')?.addEventListener('click', async () => {
    try {
      localStorage.clear()
      sessionStorage.clear()
      const dbs = await (indexedDB as IDBFactory & { databases?: () => Promise<Array<{ name?: string }>> }).databases?.() ?? []
      for (const db of dbs) {
        const dbName = db.name
        if (!dbName) continue
        await new Promise<void>(res => { const req = indexedDB.deleteDatabase(dbName); req.onsuccess = () => res(); req.onerror = () => res(); req.onblocked = () => res() })
      }
    } catch { /* best-effort - reload regardless */ }
    location.reload()
  })
}

let bootBlocked = false
try {
  migrateLocalStorageKeys()
} catch (e) {
  bootBlocked = true
  showBootScreen('localstorage-migration', e)
}

if (!bootBlocked) {
  const migration = migrateLocalforageKeys()
  const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 15_000))
  Promise.race([migration, timeout])
    .then((raced) => { if (raced === 'timeout') { bootBlocked = true; showBootScreen('localforage-migration-timeout', new Error('key migration did not finish in 15s')) } })
    .catch((e) => { bootBlocked = true; showBootScreen('localforage-migration', e) })
    .finally(() => {
      if (!bootBlocked) import('./app-entry').catch((e) => showBootScreen('app-load', e))
    })
}
