# Sync Invariants

Each guard below exists because a specific shipped bug proved it necessary. Check any PR that touches these paths against this list.

- **apiKeys retain-guard (sync.js registerApiKeys)** — an account present in the push whose key vanished from the map keeps its stored key; nothing in the UI ever removes a key, so present-but-keyless is client divergence. Prevents: both old and new keys 401-ing forever after a stale map wipe.
- **Plain INSERT for apiKeys (no ON CONFLICT)** — the pre-DELETE clears cross-push rows and the batch is deduped in memory. Prevents: every push tx aborting forever on legacy DBs where the unique index failed to build.
- **Key-set delta before skip (sync.js push)** — hint/hash/conflict skips register keys only when the pushed key set differs from stored. Prevents: keys generated after the blob's last state change never registering (fresh accounts 401 forever).
- **Canonical shrink guard (sync.js push)** — an empty incoming list never overwrites a populated store unless flagged in emptiedHubs. Prevents: a fold-starved client wiping external instance-to-instance pushes.
- **emptiedHubs single-use (folded-hubs.ts)** — the fold marks a hub when it merges external content in; the marker is read on push and cleared only on confirmed success. Prevents: deliberate full removals being blocked forever, and failed pushes losing the signal.
- **Force-reconcile on manual sync (accountSync.ts)** — manual syncs always fire the reconcile POST; the server resolves connections from server_credentials when the client list is empty. Prevents: outbound pushes silently never firing (empty-array-is-truthy no-op).
- **304 pull writes no timestamp (syncStore.ts)** — lastSyncedAt holds the server clock; a 304 must not stamp local time into it. Prevents: false isRemoteNewer → mirror merge → local-only accounts erased.
- **Mirror spares never-pushed accounts (accountImportExport.ts)** — accounts created after the last confirmed push survive mirror merges; the cloud cannot have seen them. Prevents: account-erasing mirrors eating brand-new local accounts.
- **Force push forces (syncStore.ts forceFull)** — bypasses the client hash-skip and omits contentHint. Prevents: the button being a no-op on unchanged state.
