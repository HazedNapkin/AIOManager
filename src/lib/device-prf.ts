import { generateDeviceSecret, type DeviceSecretSource } from './device-credential.ts'

const PRF_SALT_PREFIX = 'aiomanager-device-secret-v1:'

interface PrfExtensionResults {
    prf?: {
        enabled?: boolean
        results?: { first?: { bits?: ArrayBuffer } }
    }
}

function rpId(): string {
    const location = (globalThis as { location?: { hostname?: string } }).location
    return location?.hostname || 'localhost'
}

export function prfSalt(accountUUID: string): Uint8Array {
    return new TextEncoder().encode(PRF_SALT_PREFIX + accountUUID)
}

export async function supportsPrfUnlock(): Promise<boolean> {
    try {
        if (typeof PublicKeyCredential === 'undefined') return false
        if (typeof navigator === 'undefined' || typeof navigator.credentials?.create !== 'function') return false
        return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
    } catch {
        return false
    }
}

async function accountUserHandle(accountUUID: string): Promise<Uint8Array> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(accountUUID))
    return new Uint8Array(digest)
}

async function evaluatePrf(accountUUID: string, credentialId: Uint8Array): Promise<Uint8Array> {
    const assertion = (await navigator.credentials.get({
        publicKey: {
            challenge: crypto.getRandomValues(new Uint8Array(32)) as BufferSource,
            rpId: rpId(),
            allowCredentials: [{ id: credentialId as BufferSource, type: 'public-key' }],
            userVerification: 'required',
            extensions: { prf: { eval: { first: prfSalt(accountUUID) as BufferSource } } },
        },
    })) as PublicKeyCredential | null
    if (!assertion) throw new Error('Passkey unlock was cancelled')
    const results = assertion.getClientExtensionResults() as AuthenticationExtensionsClientOutputs & PrfExtensionResults
    const bits = results?.prf?.results?.first?.bits
    if (!bits) throw new Error('This device did not return a passkey secret')
    return new Uint8Array(bits)
}

export interface PrfEnrollResult {
    deviceSecret: Uint8Array
    credentialId: Uint8Array
}

export async function enrollPrfDeviceSecret(accountUUID: string): Promise<PrfEnrollResult> {
    const creation = (await navigator.credentials.create({
        publicKey: {
            challenge: crypto.getRandomValues(new Uint8Array(32)) as BufferSource,
            rp: { name: 'AIOManager', id: rpId() },
            user: {
                id: (await accountUserHandle(accountUUID)) as BufferSource,
                name: accountUUID,
                displayName: accountUUID,
            },
            pubKeyCredParams: [
                { type: 'public-key', alg: -7 },
                { type: 'public-key', alg: -257 },
            ],
            authenticatorSelection: {
                authenticatorAttachment: 'platform',
                userVerification: 'required',
                residentKey: 'preferred',
            },
            extensions: { prf: {} },
        },
    })) as PublicKeyCredential | null
    if (!creation) throw new Error('Passkey creation was cancelled')
    const results = creation.getClientExtensionResults() as AuthenticationExtensionsClientOutputs & PrfExtensionResults
    if (results?.prf?.enabled !== true) throw new Error('This device does not support passkey unlock')
    const credentialId = new Uint8Array(creation.rawId)
    const deviceSecret = await evaluatePrf(accountUUID, credentialId)
    return { deviceSecret, credentialId }
}

export async function unlockPrfDeviceSecret(accountUUID: string, credentialId: Uint8Array): Promise<Uint8Array> {
    return evaluatePrf(accountUUID, credentialId)
}

export const prfDeviceSecretSource: DeviceSecretSource = {
    tier: 'prf',
    async create(accountUUID) {
        const enrolled = await enrollPrfDeviceSecret(accountUUID)
        return { deviceSecret: enrolled.deviceSecret, credentialId: enrolled.credentialId }
    },
}

export type PrfUnlockFailure = 'cancelled' | 'credential-gone'

export function classifyPrfUnlockFailure(err: unknown): PrfUnlockFailure {
    const name = (err as { name?: string } | null)?.name
    if (name === 'InvalidStateError' || name === 'NotFoundError') return 'credential-gone'
    return 'cancelled'
}

export interface DeviceSecretEnrollment {
    tier: 'idb' | 'prf'
    deviceSecret: Uint8Array
    credentialId?: Uint8Array
}

export async function createDeviceSecretEnrollment(accountUUID: string): Promise<DeviceSecretEnrollment> {
    if (await supportsPrfUnlock()) {
        try {
            const enrolled = await enrollPrfDeviceSecret(accountUUID)
            return { tier: 'prf', deviceSecret: enrolled.deviceSecret, credentialId: enrolled.credentialId }
        } catch {}
    }
    return { tier: 'idb', deviceSecret: generateDeviceSecret() }
}
