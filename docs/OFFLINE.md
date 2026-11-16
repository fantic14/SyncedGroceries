# Offline cache and replay

Milestone 3 implements offline reads, durable edits/drafts, restart recovery, and bounded replay. Hosted and physical-device acceptance remain pending. The original local grocery preview stays independent.

## Durable storage

Phones use Expo SQLite with WAL/FULL durability. The browser preview uses IndexedDB, without SQLite WebAssembly/SharedArrayBuffer hosting requirements. Each atomic record contains the confirmed snapshot, optimistic intentions, frozen requests, draft/base text, conflicts, and retry state. The UI shows a change as queued only after this record commits; cache and outbox cannot be saved separately.

Records are partitioned by full backend URL, authenticated user ID, and household ID. Native database content is ordinary app-sandbox data, not SQLCipher-encrypted. Auth tokens remain in SecureStore on phones and tab-scoped sessionStorage in the browser; they never enter grocery storage or recovery exports.

The native app has one writer per scope. Use **one active browser tab per account/household**; concurrent cross-tab document writers are unsupported. Storage initialization/quota errors are visible, with no volatile fallback.

## Edits, drafts, and replay

Open a household online once to cache its list, note, and membership. You can then add/edit/buy/remove groceries offline and restart the app. Typing a note saves a local draft; **Save household note** queues that text for the household. A draft alone is not sent.

Foreground/reconnect reconciliation confirms account/membership and fetches an authorized snapshot. FIFO replay compares intended fields against server revisions. Before sending, it persists the exact operation UUID, payload, and revision. Acknowledgement commits the new confirmed data and operation removal together. If the response or that local commit is lost, restart retries the frozen request unchanged; server idempotency prevents duplicate application.

Network failures persist exponential retry times, capped at 60 seconds. Network/resume events, due-retry timers, Realtime invalidation, and safety polling wake reconciliation. Backgrounding pauses new sends; an in-flight acknowledgement may still be saved. Manual retry can bypass delay. Connectivity is a hint, not proof of server availability.

Independent grocery fields can rebase. Overlapping changes become persisted conflicts. Tombstones prevent resurrection by stale edits. Note conflicts retain both versions across restart. Choosing the shared note explicitly discards unsent note changes; choosing the local draft creates a new revision-checked operation. Failed edits block FIFO replay until reviewed/discarded and remain recoverable.

Snapshots reconcile in full, including tombstones. Incremental cursors and history compaction are deferred. Device clocks schedule retries and label local actions; they do not decide server edit ordering.

## Accounts and membership

- Cached membership opens the correct household offline, with a visible saved-data label. It is not current server authorization.
- After a retryable refresh failure, the app may read the actual stored expired session only to scope local data. No session is fabricated; writes wait for account confirmation/reauthentication.
- Terminal credential rejection hides authenticated UI but preserves an isolated queue for same-user reauthentication.
- Explicit logout/account deletion or switching users purges the prior account's local data after a warning. Failed cleanup stays visible and can be retried.
- Purge/scope generations fence active writes and delayed database opens, so old callbacks cannot recreate logged-out data.
- Confirmed membership change quarantines the old household's queue and hides its server snapshot before replacing membership. Rejoining does not automatically submit quarantined edits.
- Recovery exports only the user's draft and intended patches, excluding cached server records, old note bases, and conflict payloads. It never sends work into another household.

An offline device cannot discover server-side removal until reconnecting. RLS/RPCs still authorize every server request. Hosted session/membership races require acceptance testing.

The auth storage key now includes the complete normalized backend URL. Existing development sessions from before this change require one-time sign-in; there was no durable outbox before milestone 3.

## Validation and remaining acceptance

`npm run check` includes real SQLite file-reopen/rollback tests, durable replay/conflict/backoff tests, identity isolation, recovery, and existing PostgreSQL/RLS tests. An integration test closes/reopens SQLite after a lost server acknowledgement and verifies exact-request replay with one server edit.

On both iPhone and Samsung, verify airplane-mode edits/drafts, force-stop/reopen/reconnect, conflicting two-device edits, session expiry, removed/re-invited members, delayed logout/account-switch requests, low storage/corruption, power saving, keyboard, and Back navigation. See [TESTING.md](TESTING.md).

Rebuild native development clients after adding SQLite and NetInfo. JavaScript exports do not establish signed APK/IPA compilation or device execution.
