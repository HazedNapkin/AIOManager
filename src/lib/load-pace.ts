/**
 * Load pacing core for store-published values.
 *
 * During a library load, per-account watch-event diffs publish in a burst and every
 * intermediate publication used to trigger a full history derivation. This tiny
 * clock-injected helper answers one question — "may a value be emitted now, and if
 * not, how long until it may?" — so a React wrapper can throttle publications to a
 * bounded cadence while always delivering the newest value on the trailing edge.
 *
 * Semantics (throttle with trailing catch-up, NOT a debounce):
 * - The first emission after creation (or after `reset`) is always allowed.
 * - While inside the pace interval emissions are withheld and `nextDelayMs()` counts
 *   down to the moment the next one is allowed; a caller re-scheduling on every
 *   update still emits at fixed spacing, never drifting later under sustained load.
 */

export interface PaceClock {
    now(): number
}

export interface LoadPacer {
    /** True when an emission is allowed right now under the pace interval. */
    canEmit(): boolean
    /** Record that an emission happened at the clock's current time. */
    markEmit(): void
    /** Milliseconds until the next emission is allowed (<= 0 means now). */
    nextDelayMs(): number
    /** Forget the last emission time; the next check allows an immediate emit. */
    reset(): void
}

const defaultClock: PaceClock = { now: () => Date.now() }

export function createLoadPacer(paceMs: number, clock: PaceClock = defaultClock): LoadPacer {
    if (!Number.isFinite(paceMs) || paceMs <= 0) throw new Error('createLoadPacer: paceMs must be a positive finite number')
    let lastEmit = -Infinity
    return {
        canEmit() {
            return clock.now() - lastEmit >= paceMs
        },
        markEmit() {
            lastEmit = clock.now()
        },
        nextDelayMs() {
            return paceMs - (clock.now() - lastEmit)
        },
        reset() {
            lastEmit = -Infinity
        },
    }
}
