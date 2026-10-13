// Budgeted parallel scan runner for the activity engine.
//
// The serial loop this replaces cost sum(scanAccount) per cycle: p50 199ms per
// account on real data, so 22 accounts = 4.5s and 150 accounts = 30s+ per cycle,
// with each dead platform eating its full 10s fetch timeout alone in line.
//
// Two invariants survive the move to parallelism, both covered by tests:
//  1. Cycle-level write caps hold under concurrency. In-flight scans RESERVE
//     budget at dispatch and release the unused part on completion, so N greedy
//     scans finishing together cannot collectively overshoot the caps the way
//     naive "pass the remaining budget to whoever starts next" would.
//  2. Serial-loop halt semantics: a scan that ran out of its own budget
//     (complete === false) stops the dispatch of NEW scans for this cycle,
//     exactly like the serial `break` did; in-flight scans finish.

export async function runBudgetedScan({
    items,
    concurrency = 1,
    deadline = 0,
    maxEvents = Infinity,
    maxSnapshots = Infinity,
    now = () => Date.now(),
    scanItem,
}) {
    const norm = (v) => (Number.isFinite(v) ? Math.max(0, Math.floor(v)) : Infinity)
    maxEvents = norm(maxEvents)
    maxSnapshots = norm(maxSnapshots)

    const summary = {
        scanned: 0,
        eventsWritten: 0,
        snapshotWrites: 0,
        snapshotDeletes: 0,
        budgetExhausted: false,
    }

    let nextIndex = 0
    let halted = false
    let eventsReserved = 0
    let snapshotsReserved = 0

    // Fair-share claim: each in-flight scan reserves at most ceil(cap / concurrency),
    // and reservations collectively cannot exceed the cap. Claiming the whole
    // remaining budget (the serial loop's rule) would let the FIRST concurrent
    // scan starve the rest; claiming without reservation would let them overshoot.
    const fairShare = (cap) => cap === Infinity ? Infinity : Math.max(1, Math.ceil(cap / concurrency))
    const eventsShare = fairShare(maxEvents)
    const snapshotsShare = fairShare(maxSnapshots)

    const claim = (share, reserved, cap, used) => {
        if (cap === Infinity) return Infinity
        const max = cap - used - reserved
        if (max <= 0) return 0
        return Math.min(share, max)
    }

    const claimEvents = () => {
        const claimed = claim(eventsShare, eventsReserved, maxEvents, summary.eventsWritten)
        if (Number.isFinite(claimed)) eventsReserved += claimed
        return claimed
    }

    const claimSnapshots = () => {
        const claimed = claim(snapshotsShare, snapshotsReserved, maxSnapshots, summary.snapshotWrites)
        if (Number.isFinite(claimed)) snapshotsReserved += claimed
        return claimed
    }

    const releaseEvents = (claimed) => {
        if (Number.isFinite(claimed)) eventsReserved -= claimed
    }

    const releaseSnapshots = (claimed) => {
        if (Number.isFinite(claimed)) snapshotsReserved -= claimed
    }

    const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
        while (true) {
            if (halted) return
            const i = nextIndex++
            if (i >= items.length) return
            if (deadline && now() >= deadline) {
                summary.budgetExhausted = true
                return
            }

            const item = items[i]
            const claimedEvents = claimEvents()
            const claimedSnapshots = claimSnapshots()
            if (claimedEvents === 0 || claimedSnapshots === 0) {
                summary.budgetExhausted = true
                return
            }

            let result
            try {
                result = await scanItem(item, { deadline, maxEvents: claimedEvents, maxSnapshots: claimedSnapshots })
            } catch {
                result = null
            }

            // Release the unused reservation before accounting the used part.
            releaseEvents(claimedEvents)
            releaseSnapshots(claimedSnapshots)

            if (!result) continue

            const usedEvents = Math.min(result.eventsWritten ?? 0, claimedEvents)
            const usedSnapshots = Math.min(result.snapshotWrites ?? 0, claimedSnapshots)
            summary.scanned++
            summary.eventsWritten += usedEvents
            summary.snapshotWrites += usedSnapshots
            summary.snapshotDeletes += result.snapshotDeletes ?? 0

            if (result.complete === false) {
                // Budget-limited mid-scan: preserve the serial loop's `break` -
                // no NEW scans this cycle; remaining accounts wait for the next one.
                summary.budgetExhausted = true
                halted = true
            }
        }
    })

    await Promise.all(workers)
    if (nextIndex < items.length && !summary.budgetExhausted) {
        // Defensive: workers exited early without a recorded cause.
        summary.budgetExhausted = true
    }
    return summary
}
