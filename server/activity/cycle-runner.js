// Reserve each scan's budget before dispatch; release unused reservations on completion.
// An incomplete scan stops new dispatches while in-flight scans finish.

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
    let inFlight = 0
    const budgetWaiters = new Set()
    const wakeBudgetWaiters = () => {
        for (const wake of budgetWaiters) wake()
        budgetWaiters.clear()
    }

    // Split reservations across workers without exceeding either cycle cap.
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
            if (nextIndex >= items.length) return
            if (deadline && now() >= deadline) {
                summary.budgetExhausted = true
                return
            }

            const availableEvents = claim(eventsShare, eventsReserved, maxEvents, summary.eventsWritten)
            const availableSnapshots = claim(snapshotsShare, snapshotsReserved, maxSnapshots, summary.snapshotWrites)
            if (availableEvents === 0 || availableSnapshots === 0) {
                // A reservation may be released unused. Wait before consuming the
                // next account; only completed writes can exhaust the cycle cap.
                if (inFlight > 0) {
                    await new Promise(resolve => budgetWaiters.add(resolve))
                    continue
                }
                summary.budgetExhausted = true
                return
            }
            const item = items[nextIndex++]
            const claimedEvents = claimEvents()
            const claimedSnapshots = claimSnapshots()
            inFlight++

            let result
            try {
                result = await scanItem(item, { deadline, maxEvents: claimedEvents, maxSnapshots: claimedSnapshots })
            } catch {
                result = null
            }

            releaseEvents(claimedEvents)
            releaseSnapshots(claimedSnapshots)
            inFlight--

            if (!result) {
                wakeBudgetWaiters()
                continue
            }

            const usedEvents = Math.min(result.eventsWritten ?? 0, claimedEvents)
            const usedSnapshots = Math.min(result.snapshotWrites ?? 0, claimedSnapshots)
            summary.scanned++
            summary.eventsWritten += usedEvents
            summary.snapshotWrites += usedSnapshots
            summary.snapshotDeletes += result.snapshotDeletes ?? 0

            if (result.complete === false) {
                // An incomplete scan halts new dispatches for this cycle.
                summary.budgetExhausted = true
                halted = true
            }
            wakeBudgetWaiters()
        }
    })

    await Promise.all(workers)
    if (nextIndex < items.length && !summary.budgetExhausted) {

        summary.budgetExhausted = true
    }
    return summary
}
