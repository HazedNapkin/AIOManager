export async function nuvioDriverFrom(body = {}) {
    const { createNuvioDriver } = await import('../providers/nuvio-driver.js')
    return createNuvioDriver({
        ...(body.baseUrl ? { baseUrl: body.baseUrl } : {}),
        ...(body.publishableKey ? { publishableKey: body.publishableKey } : {})
    })
}

// sessionAware surfaces an upstream 400 (P0001 session raise) as a client 400; only the
// qr/poll and qr/exchange routes want that — the password-auth ladder must let a 400
// fall through to the isAuthError ? 401 : 502 branch.
export function mapNuvioLoginError(reply, err, { authMessage, sessionAware = false, timeoutMessage } = {}) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        reply.code(504)
        return { error: timeoutMessage || 'Nuvio login timed out. Please try again in a few seconds.' }
    }
    if (sessionAware && err.status === 400) {
        reply.code(400)
        return { error: 'Invalid or expired login session' }
    }
    if (err.status === 429) {
        reply.code(429)
        return { error: 'Too many login attempts. Please wait a few minutes before retrying.' }
    }
    const status = err.isAuthError ? 401 : 502
    reply.code(status)
    return { error: err.isAuthError ? authMessage : 'Nuvio service unreachable' }
}
