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

export async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder()
  const strPassword = String(password)
  const passwordBuffer = encoder.encode(strPassword)

  const keyMaterial = await crypto.subtle.importKey('raw', passwordBuffer, 'PBKDF2', false, [
    'deriveBits',
    'deriveKey',
  ])

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  )
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
  const encoder = new TextEncoder()
  const strPassword = String(password)
  const passwordBuffer = encoder.encode(strPassword)

  const keyMaterial = await crypto.subtle.importKey('raw', passwordBuffer, 'PBKDF2', false, [
    'deriveBits',
  ])

  const hashBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  )

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
  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(String(password)), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: (salt ?? SYNC_KEY_SALT) as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

export async function encryptSyncPayload(plaintext: string, password: string, salt?: Uint8Array): Promise<string> {
  const key = await deriveSyncEncryptionKey(password, salt)
  return encrypt(plaintext, key)
}

export async function decryptSyncPayload(ciphertext: string, password: string, salt?: Uint8Array): Promise<string> {
  const key = await deriveSyncEncryptionKey(password, salt)
  try {
    return await decrypt(ciphertext, key)
  } catch {
    const { AES, enc } = await import('crypto-js')
    const bytes = AES.decrypt(ciphertext, password)
    const decrypted = bytes.toString(enc.Utf8)
    if (!decrypted) throw new Error('Decryption failed')
    return decrypted
  }
}
