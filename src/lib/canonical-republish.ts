export interface RepublishHost {
    isAuthenticated(): boolean
    runRepublish(): Promise<unknown>
    getPrevSet(): string[] | null
    setPrevSet(next: string[]): void
    membershipChanged(prev: string[] | null, next: string[] | null): boolean
    schedule(fn: () => void, delayMs: number): unknown
    cancel(handle: unknown): void
}

let host: RepublishHost

export function bindRepublishHost(h: RepublishHost) {
    host = h
}

let _pending = false
let _timer: unknown = null
let _attempts = 0

const MAX_ATTEMPTS = 5

export function _republishStateForTest() {
    return { pending: _pending, attempts: _attempts, timerArmed: _timer !== null }
}

function armRepublishTimer(delayMs: number) {
    if (_timer !== null) return
    _timer = host.schedule(async () => {
        _timer = null
        if (!host.isAuthenticated()) { _pending = false; _attempts = 0; return }
        try {
            await host.runRepublish()
        } catch {}
        if (_pending && _attempts < MAX_ATTEMPTS) {
            _attempts += 1
            armRepublishTimer(Math.min(5000 * _attempts, 30000))
        }
    }, delayMs)
}

// Single adoption point for the server-reported Stremio-credentialed account set. The
// adoption only fires when membership (or the null->known transition) actually changes
// so a fresh array on every push response can't re-render every subscribed account row.
export function learnServerCredentialedAccounts(next: unknown) {
    if (!Array.isArray(next)) return
    const prev = host.getPrevSet()
    if (prev === next) return
    const changed = host.membershipChanged(prev, next)
    if (!changed && prev !== null) return
    host.setPrevSet(next)
    if (changed) {
        // The push payload is built before the response teaches us serverStremioCredentialedAccounts,
        // so a membership change (first learn, or a credential added/removed server-side) means
        // the canonical lists we just pushed are stale. Force one re-push: bypass the client
        // hash-skip and omit contentHint (the hint covers state only, so the server's hint-skip
        // would also swallow the corrected canonical rows). A fresh change resets the retry
        // budget — an exhausted counter must not disarm new information.
        _pending = true
        _attempts = 0
        armRepublishTimer(1500)
    }
}

// The push success handler's credential adoption. Clear BEFORE learning: a second
// membership change revealed by this response must survive to arm its own follow-up —
// the regression test fails on the learn-then-clear ordering.
export function adoptPushResponseCredentials(force: boolean, serverSet: unknown) {
    if (force) _pending = false
    learnServerCredentialedAccounts(serverSet)
}

export function consumeForceFlag(): boolean {
    return _pending
}

export function resetRepublishAttempts() {
    _attempts = 0
}

export function clearRepublishState() {
    if (_timer !== null) host.cancel(_timer)
    _timer = null
    _pending = false
    _attempts = 0
}
