import { trace } from '@/lib/trace'

const PBKDF2_ITERATIONS = 600000
const SALT_LENGTH = 16
const IV_LENGTH = 12

const STORAGE_KEYS = {
  USER_SALT: 'stremio-manager:user-salt',
  PASSWORD_HASH: 'stremio-manager:password-hash',
  SESSION_KEY: 'stremio-manager:session-key',
}

/**
 * Derive a secure authentication token for Cloud Sync.
 * This is a one-way hash (SHA-256) of the master password.
 * The server stores this hash, meaning it never sees the actual password.
 */
export async function deriveSyncToken(password: string, salt?: string): Promise<string> {
  const encoder = new TextEncoder()
  const strPassword = String(password)
  const pepper = salt ? `:sync-auth-token:${salt}` : ':sync-auth-token'
  const data = encoder.encode(strPassword + pepper)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

let pbkdf2Worker: Worker | null = null
let pbkdf2WorkerFailed = false
let pbkdf2RequestId = 0

interface Pbkdf2WorkerRequest {
  id: number
  password: string
  salt: Uint8Array
  iterations: number
  length: number
}

interface Pbkdf2WorkerResponse {
  id: number
  bits?: ArrayBuffer
  error?: string
}

function getPbkdf2Worker(): Worker | null {
  if (pbkdf2WorkerFailed) return null
  if (pbkdf2Worker) return pbkdf2Worker
  try {
    pbkdf2Worker = new Worker(new URL('../workers/pbkdf2-worker.ts', import.meta.url))
    return pbkdf2Worker
  } catch {
    pbkdf2WorkerFailed = true
    return null
  }
}

async function derivePbkdf2OnMain(
  password: string,
  salt: Uint8Array,
  iterations: number,
  length: number
): Promise<ArrayBuffer> {
  const encoder = new TextEncoder()
  const passwordBuffer = encoder.encode(String(password))
  const keyMaterial = await crypto.subtle.importKey('raw', passwordBuffer, 'PBKDF2', false, [
    'deriveBits',
  ])
  return crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    length
  )
}

function derivePbkdf2ViaWorker(
  password: string,
  salt: Uint8Array,
  iterations: number,
  length: number
): Promise<ArrayBuffer> {
  const worker = getPbkdf2Worker()
  if (!worker) {
    trace('crypto', 'pbkdf2.path', { path: 'main', reason: 'no-worker' })
    return derivePbkdf2OnMain(password, salt, iterations, length)
  }
  const id = ++pbkdf2RequestId
  return new Promise<ArrayBuffer>((resolve) => {
    let completed = false
    const cleanup = () => {
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
    }
    const doResolve = (value: PromiseLike<ArrayBuffer> | ArrayBuffer) => {
      if (!completed) {
        completed = true
        cleanup()
        clearTimeout(timer)
        resolve(value)
      }
    }
    const onMessage = (event: MessageEvent<Pbkdf2WorkerResponse>) => {
      const data = event.data
      if (!data || data.id !== id) return
      if (data.error || !data.bits) {
        trace('crypto', 'pbkdf2.path', { path: 'main', reason: 'worker-error' })
        doResolve(derivePbkdf2OnMain(password, salt, iterations, length))
      } else {
        trace('crypto', 'pbkdf2.path', { path: 'worker' })
        doResolve(data.bits)
      }
    }
    const onError = () => {
      pbkdf2WorkerFailed = true
      trace('crypto', 'pbkdf2.path', { path: 'main', reason: 'worker-error' })
      doResolve(derivePbkdf2OnMain(password, salt, iterations, length))
    }
    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)
    const request: Pbkdf2WorkerRequest = { id, password, salt, iterations, length }
    worker.postMessage(request)
    const timer = setTimeout(() => {
      pbkdf2WorkerFailed = true
      worker.terminate()
      trace('crypto', 'pbkdf2.path', { path: 'main', reason: 'worker-timeout' })
      doResolve(derivePbkdf2OnMain(password, salt, iterations, length))
    }, 5000)
  })
}

async function runPbkdf2(
  password: string,
  salt: Uint8Array,
  iterations: number,
  length: number
): Promise<ArrayBuffer> {
  try {
    return await derivePbkdf2ViaWorker(password, salt, iterations, length)
  } catch {
    return derivePbkdf2OnMain(password, salt, iterations, length)
  }
}

export async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const start = Date.now()
  trace('crypto', 'deriveKey.start', { iterations: PBKDF2_ITERATIONS })
  try {
    const bits = await runPbkdf2(String(password), salt, PBKDF2_ITERATIONS, 256)
    const key = await crypto.subtle.importKey(
      'raw',
      bits,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    )
    trace('crypto', 'deriveKey.success', { timing: Date.now() - start })
    return key
  } catch (err) {
    trace('crypto', 'deriveKey.error', { timing: Date.now() - start, error: (err as Error)?.message })
    throw err
  }
}

export async function encrypt(data: string, key: CryptoKey): Promise<string> {
  const encoder = new TextEncoder()
  const dataBuffer = encoder.encode(String(data))

  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))

  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, dataBuffer)

  const combined = new Uint8Array(iv.length + ciphertext.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(ciphertext), iv.length)

  let binary = ''
  for (let i = 0; i < combined.length; i++) {
    binary += String.fromCharCode(combined[i])
  }
  return btoa(binary)
}

export async function decrypt(encrypted: string, key: CryptoKey): Promise<string> {
  if (!encrypted) return ''
  const combined = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0))

  const iv = combined.slice(0, IV_LENGTH)
  const ciphertext = combined.slice(IV_LENGTH)

  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)

  const decoder = new TextDecoder()
  return decoder.decode(decrypted)
}

export async function hashPassword(password: string, salt: Uint8Array): Promise<string> {
  const hashBits = await runPbkdf2(String(password), salt, PBKDF2_ITERATIONS, 256)

  const hashArray = new Uint8Array(hashBits)
  return btoa(String.fromCharCode(...hashArray))
}

export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
}

export function loadSalt(): Uint8Array | null {
  try {
    const saltBase64 = localStorage.getItem(STORAGE_KEYS.USER_SALT)
    if (!saltBase64) return null
    return Uint8Array.from(atob(saltBase64), (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

export function saveSalt(salt: Uint8Array): boolean {
  try {
    const saltBase64 = btoa(String.fromCharCode(...salt))
    localStorage.setItem(STORAGE_KEYS.USER_SALT, saltBase64)
    return true
  } catch {
    console.warn('Your session may not persist across page reloads.')
    return false
  }
}

export function loadPasswordHash(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEYS.PASSWORD_HASH)
  } catch {
    return null
  }
}

export function savePasswordHash(hash: string): boolean {
  try {
    localStorage.setItem(STORAGE_KEYS.PASSWORD_HASH, hash)
    return true
  } catch {
    console.warn('Your session may not persist across page reloads.')
    return false
  }
}

export function isPasswordSetup(): boolean {
  return !!(loadSalt() && loadPasswordHash())
}

export async function saveSessionKey(key: CryptoKey): Promise<void> {
  try {
    const keyBuffer = await crypto.subtle.exportKey('raw', key)
    const keyArray = new Uint8Array(keyBuffer)

    const keyBase64 = btoa(String.fromCharCode(...keyArray))
    sessionStorage.setItem(STORAGE_KEYS.SESSION_KEY, keyBase64)
  } catch (error) {
    if (import.meta.env.DEV) console.error('Failed to save session key:', error)
    throw error
  }
}

export async function loadSessionKey(): Promise<CryptoKey | null> {
  try {
    const keyBase64 = sessionStorage.getItem(STORAGE_KEYS.SESSION_KEY)
    if (!keyBase64) return null

    const keyArray = Uint8Array.from(atob(keyBase64), (c) => c.charCodeAt(0))

    const key = await crypto.subtle.importKey(
      'raw',
      keyArray,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    )

    return key
  } catch (error) {
    if (import.meta.env.DEV) console.error('Failed to load session key:', error)
    return null
  }
}

export function clearSessionKey(): void {
  sessionStorage.removeItem(STORAGE_KEYS.SESSION_KEY)
}

export interface LocalAuthSecretsSnapshot {
  passwordHash: string | null
  userSalt: string | null
  sessionKey: string | null
}

export function clearLocalAuthSecrets(): LocalAuthSecretsSnapshot {
  const snapshot: LocalAuthSecretsSnapshot = {
    passwordHash: null,
    userSalt: null,
    sessionKey: null,
  }
  try {
    snapshot.passwordHash = localStorage.getItem(STORAGE_KEYS.PASSWORD_HASH)
    snapshot.userSalt = localStorage.getItem(STORAGE_KEYS.USER_SALT)
    snapshot.sessionKey = sessionStorage.getItem(STORAGE_KEYS.SESSION_KEY)
    localStorage.removeItem(STORAGE_KEYS.PASSWORD_HASH)
    localStorage.removeItem(STORAGE_KEYS.USER_SALT)
    sessionStorage.removeItem(STORAGE_KEYS.SESSION_KEY)
  } catch {
    // Storage may be blocked; caller can still continue with cloud login.
  }
  return snapshot
}

export function restoreLocalAuthSecrets(snapshot: LocalAuthSecretsSnapshot): void {
  try {
    if (snapshot.passwordHash) localStorage.setItem(STORAGE_KEYS.PASSWORD_HASH, snapshot.passwordHash)
    else localStorage.removeItem(STORAGE_KEYS.PASSWORD_HASH)
    if (snapshot.userSalt) localStorage.setItem(STORAGE_KEYS.USER_SALT, snapshot.userSalt)
    else localStorage.removeItem(STORAGE_KEYS.USER_SALT)
    if (snapshot.sessionKey) sessionStorage.setItem(STORAGE_KEYS.SESSION_KEY, snapshot.sessionKey)
    else sessionStorage.removeItem(STORAGE_KEYS.SESSION_KEY)
  } catch {
    // Best-effort rollback for recovery flows.
  }
}

const SYNC_KEY_SALT = new TextEncoder().encode('aiomanager-sync-key-v2')

export async function deriveSyncEncryptionKey(password: string, salt?: Uint8Array): Promise<CryptoKey> {
  const bits = await runPbkdf2(String(password), salt ?? SYNC_KEY_SALT, PBKDF2_ITERATIONS, 256)
  return crypto.subtle.importKey(
    'raw',
    bits,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

export async function encryptSyncPayload(plaintext: string, password: string, salt?: Uint8Array): Promise<string> {
  const start = Date.now()
  trace('crypto', 'encryptSyncPayload.start', { bytes: plaintext.length })
  try {
    const key = await deriveSyncEncryptionKey(password, salt)
    const result = await encrypt(plaintext, key)
    trace('crypto', 'encryptSyncPayload.success', { bytes: plaintext.length, timing: Date.now() - start })
    return result
  } catch (err) {
    trace('crypto', 'encryptSyncPayload.error', { bytes: plaintext.length, timing: Date.now() - start, error: (err as Error)?.message })
    throw err
  }
}

export async function decryptSyncPayload(ciphertext: string, password: string, salt?: Uint8Array): Promise<string> {
  const start = Date.now()
  trace('crypto', 'decryptSyncPayload.start', {})
  try {
    const key = await deriveSyncEncryptionKey(password, salt)
    try {
      const result = await decrypt(ciphertext, key)
      trace('crypto', 'decryptSyncPayload.success', { path: 'gcm', timing: Date.now() - start })
      return result
    } catch {
      const { AES, enc } = await import('crypto-js')
      const bytes = AES.decrypt(ciphertext, password)
      const decrypted = bytes.toString(enc.Utf8)
      if (!decrypted) throw new Error('Decryption failed')
      trace('crypto', 'decryptSyncPayload.success', { path: 'legacy-fallback', timing: Date.now() - start })
      return decrypted
    }
  } catch (err) {
    trace('crypto', 'decryptSyncPayload.error', { timing: Date.now() - start, error: (err as Error)?.message })
    throw err
  }
}
