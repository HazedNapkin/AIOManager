interface Pbkdf2Request {
  id: number
  password: string
  salt: Uint8Array
  iterations: number
  length: number
}

interface Pbkdf2Response {
  id: number
  bits: ArrayBuffer
}

interface Pbkdf2ErrorResponse {
  id: number
  error: string
}

self.onmessage = async (e: MessageEvent<Pbkdf2Request>) => {
  const { id, password, salt, iterations, length } = e.data
  try {
    const encoder = new TextEncoder()
    const passwordBuffer = encoder.encode(String(password))
    const keyMaterial = await crypto.subtle.importKey('raw', passwordBuffer, 'PBKDF2', false, ['deriveBits'])
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
      keyMaterial,
      length
    )
    const response: Pbkdf2Response = { id, bits }
    self.postMessage(response)
  } catch (err) {
    const response: Pbkdf2ErrorResponse = {
      id,
      error: err instanceof Error ? err.message : String(err),
    }
    self.postMessage(response)
  }
}
