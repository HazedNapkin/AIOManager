// Preserve the standard base64 wire format while avoiding binary strings on
// browsers with typed-array codecs. Older browsers keep the same atob/btoa path.
export function bytesToBase64(bytes: Uint8Array): string {
    const native = bytes as Uint8Array & { toBase64?: () => string }
    if (typeof native.toBase64 === 'function') return native.toBase64()
    let binary = ''
    const chunkSize = 0x8000
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
    }
    return btoa(binary)
}

export function base64ToBytes(encoded: string): Uint8Array {
    const native = Uint8Array as typeof Uint8Array & { fromBase64?: (value: string) => Uint8Array }
    if (typeof native.fromBase64 === 'function') return native.fromBase64(encoded)
    const binary = atob(encoded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
}
