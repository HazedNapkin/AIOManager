// Pure absorb-outcome decision, split from connection-discovery.ts so the
// deletion-propagation semantics are unit-testable (see connection-discovery.test.ts).

export interface AbsorbOutcome {
    changed: boolean
    propagateDeletions: boolean
}

export function evaluateAbsorbOutcome(
    _rawDiscoveredCount: number,
    survivingCount: number,
    tombstonedCount: number,
): AbsorbOutcome {
    if (survivingCount === 0) return { changed: false, propagateDeletions: tombstonedCount > 0 }
    return { changed: true, propagateDeletions: tombstonedCount > 0 }
}
