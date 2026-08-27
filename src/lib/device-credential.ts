const SECRET_LENGTH = 32
const IV_LENGTH = 12
const WRAP_INFO_PREFIX = 'aioman/wrap/v1:'

const MAGIC = new Uint8Array([0x41, 0x49, 0x44, 0x31])
const FORMAT_VERSION = 1
const HEADER_LENGTH = MAGIC.length + 1 + 4

export class DeviceCredentialError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'DeviceCredentialError'
    }
}

export interface DeviceSecretBundle {
    deviceToken: string
    vaultKey: Uint8Array
    userSalt: string
    syncKey?: Uint8Array
}

export interface DeviceBlobAad {
    v: 1
    alg: 'A256GCM'
    accountUUID: string
    deviceId: string
    createdAt: string
}

export interface DeviceSecretEnrollmentResult {
    deviceSecret: Uint8Array
    credentialId?: Uint8Array
}

export interface DeviceSecretSource {
    tier: 'idb' | 'prf'
    create(accountUUID: string): Promise<DeviceSecretEnrollmentResult>
}

export const idbDeviceSecretSource: DeviceSecretSource = {
    tier: 'idb',
    async create() {
        return { deviceSecret: generateDeviceSecret() }
    },
}

export function generateDeviceSecret(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(SECRET_LENGTH))
}

export function deriveDeviceToken(): string {
    return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(SECRET_LENGTH)))
}

export function bytesToBase64Url(bytes: Uint8Array): string {
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64UrlToBytes(value: string): Uint8Array {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
}

export function bytesToBase64(bytes: Uint8Array): string {
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    return btoa(binary)
}

export function base64ToBytes(value: string): Uint8Array {
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
}

async function deriveWrapKey(deviceSecret: Uint8Array, accountUUID: string): Promise<CryptoKey> {
    const keyMaterial = await crypto.subtle.importKey('raw', deviceSecret as BufferSource, 'HKDF', false, ['deriveKey'])
    return crypto.subtle.deriveKey(
        {
            name: 'HKDF',
            hash: 'SHA-256',
            salt: new Uint8Array(0),
            info: new TextEncoder().encode(WRAP_INFO_PREFIX + accountUUID),
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    )
}

interface SerializedBundle {
    deviceToken: string
    vaultKey: string
    userSalt: string
    syncKey?: string
}

function serializeBundle(bundle: DeviceSecretBundle): Uint8Array {
    const serialized: SerializedBundle = {
        deviceToken: bundle.deviceToken,
        vaultKey: bytesToBase64(bundle.vaultKey),
        userSalt: bundle.userSalt,
    }
    if (bundle.syncKey) serialized.syncKey = bytesToBase64(bundle.syncKey)
    return new TextEncoder().encode(JSON.stringify(serialized))
}

function deserializeBundle(plaintext: Uint8Array): DeviceSecretBundle {
    let parsed: SerializedBundle
    try {
        parsed = JSON.parse(new TextDecoder().decode(plaintext)) as SerializedBundle
    } catch {
        throw new DeviceCredentialError('Device blob plaintext is not valid')
    }
    if (!parsed || typeof parsed.deviceToken !== 'string' || typeof parsed.vaultKey !== 'string') {
        throw new DeviceCredentialError('Device blob plaintext is missing fields')
    }
    const bundle: DeviceSecretBundle = {
        deviceToken: parsed.deviceToken,
        vaultKey: base64ToBytes(parsed.vaultKey),
        userSalt: parsed.userSalt,
    }
    if (parsed.syncKey) bundle.syncKey = base64ToBytes(parsed.syncKey)
    return bundle
}

export async function wrapBlob(
    deviceSecret: Uint8Array,
    bundle: DeviceSecretBundle,
    aad: DeviceBlobAad
): Promise<Uint8Array> {
    const key = await deriveWrapKey(deviceSecret, aad.accountUUID)
    const aadBytes = new TextEncoder().encode(JSON.stringify(aad))
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: aadBytes },
        key,
        serializeBundle(bundle) as BufferSource
    )
    const blob = new Uint8Array(HEADER_LENGTH + aadBytes.length + IV_LENGTH + ciphertext.byteLength)
    let offset = 0
    blob.set(MAGIC, offset)
    offset += MAGIC.length
    blob[offset] = FORMAT_VERSION
    offset += 1
    new DataView(blob.buffer).setUint32(offset, aadBytes.length, false)
    offset += 4
    blob.set(aadBytes, offset)
    offset += aadBytes.length
    blob.set(iv, offset)
    offset += iv.length
    blob.set(new Uint8Array(ciphertext), offset)
    return blob
}

function parseBlobLayout(blob: Uint8Array): { aad: DeviceBlobAad; iv: Uint8Array; ciphertext: Uint8Array } {
    if (blob.length < HEADER_LENGTH) throw new DeviceCredentialError('Device blob is truncated')
    for (let i = 0; i < MAGIC.length; i++) {
        if (blob[i] !== MAGIC[i]) throw new DeviceCredentialError('Device blob has an unknown format')
    }
    if (blob[MAGIC.length] !== FORMAT_VERSION) {
        throw new DeviceCredentialError(`Device blob version ${blob[MAGIC.length]} is not supported`)
    }
    const aadLength = new DataView(blob.buffer, blob.byteOffset, blob.byteLength).getUint32(MAGIC.length + 1, false)
    const aadStart = HEADER_LENGTH
    const ivStart = aadStart + aadLength
    const ciphertextStart = ivStart + IV_LENGTH
    if (blob.length < ciphertextStart) throw new DeviceCredentialError('Device blob is truncated')
    let aad: DeviceBlobAad
    try {
        aad = JSON.parse(new TextDecoder().decode(blob.subarray(aadStart, ivStart))) as DeviceBlobAad
    } catch {
        throw new DeviceCredentialError('Device blob metadata is not valid')
    }
    if (aad.v !== 1 || aad.alg !== 'A256GCM') {
        throw new DeviceCredentialError('Device blob metadata is not supported')
    }
    return {
        aad,
        iv: blob.subarray(ivStart, ciphertextStart),
        ciphertext: blob.subarray(ciphertextStart),
    }
}

export async function unwrapBlob(
    deviceSecret: Uint8Array,
    blob: Uint8Array,
    expected: { accountUUID: string; deviceId: string }
): Promise<DeviceSecretBundle> {
    const { aad, iv, ciphertext } = parseBlobLayout(blob)
    if (aad.accountUUID !== expected.accountUUID) {
        throw new DeviceCredentialError('Device blob belongs to a different sign-in')
    }
    if (aad.deviceId !== expected.deviceId) {
        throw new DeviceCredentialError('Device blob belongs to a different device')
    }
    const key = await deriveWrapKey(deviceSecret, expected.accountUUID)
    const aadBytes = new TextEncoder().encode(JSON.stringify(aad))
    let plaintext: ArrayBuffer
    try {
        plaintext = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv as BufferSource, additionalData: aadBytes },
            key,
            ciphertext as BufferSource
        )
    } catch {
        throw new DeviceCredentialError('Device blob could not be unlocked on this device')
    }
    return deserializeBundle(new Uint8Array(plaintext))
}
