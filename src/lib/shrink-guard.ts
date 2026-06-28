export const SHRINK_GUARD_RATIO = 0.25

export type ShrinkGuardReason = 'empty' | 'shrink'

export interface ShrinkGuardDecision {
    blocked: boolean
    reason?: ShrinkGuardReason
}

export function shouldBlockShrink(
    preparedCount: number,
    knownCount: number,
    allowShrink: boolean,
): ShrinkGuardDecision {
    if (allowShrink) return { blocked: false }
    if (knownCount <= 0) return { blocked: false }
    if (preparedCount === 0) return { blocked: true, reason: 'empty' }
    if (preparedCount < Math.ceil(knownCount * SHRINK_GUARD_RATIO)) {
        return { blocked: true, reason: 'shrink' }
    }
    return { blocked: false }
}
