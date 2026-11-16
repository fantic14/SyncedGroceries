# Testing checklist

## Automated checks available now

```sh
npm ci
npm run check
npm run build
```

Unit tests cover stored-data validation, empty-list preservation, shopping actions, auth input/error handling, public-only backend configuration, and chunked secure-session persistence under partial failure and concurrent writes/logout. Database tests run the actual migration in embedded PostgreSQL with real authenticated/anonymous role changes, covering household isolation and the invitation/membership boundary. Type checking and Metro export catch integration/bundling issues. These checks do not establish native runtime compatibility, hosted Auth/PostgREST behavior, or remote sync correctness.

## Identity/household: hosted acceptance checks

Follow [backend setup](BACKEND.md). These are required before marking milestone 1 complete; no hosted project or phone run is implied by passing the SQL tests.

- [ ] No environment configuration: grocery preview opens and Household & account explains sharing is not connected.
- [ ] Configure a development project, apply the migration, and set the email template to `{{ .Token }}`.
- [ ] Request a code, enter an invalid/expired code, resend after cooldown, then sign in successfully.
- [ ] Close/reopen on both phones: encrypted native session restores; background/resume refresh works.
- [ ] Create household on one account, generate an invite, and join with a different account/OS.
- [ ] The generated token remains visible after a successful refresh or returning from the share sheet.
- [ ] If a refresh fails after issuing an invite, retrying restores the code for the same user/household; sign-out or ownership loss clears it.
- [ ] Android Back returns from household setup to the preview; closing is disabled while an account/membership change is in progress.
- [ ] Reusing, revoking, or expiring a token prevents another join. Excess attempts show a rejection.
- [ ] Owners can remove members and transfer ownership; regular members cannot invoke those operations directly.
- [ ] Owner cannot leave/delete account while other members remain until ownership is transferred.
- [ ] Sign out or switch account during a slow request: old membership/invite results never appear for the new user.
- [ ] Failed membership load shows retry, rather than incorrectly offering a new household as if none exists.
- [ ] Leaving/removal revokes household reads; refresh discards stale membership.
- [ ] Confirmed account deletion affects only that account; an old JWT cannot mutate household state afterwards.
- [ ] Local preview data stays separate and is not uploaded or presented as the signed-in household's shared list.
- [ ] Navigating to household setup while a local edit is saving does not cancel that edit.

## Local starter: manual checks

Run on an iPhone and a Samsung Galaxy phone, plus the browser preview for a quick smoke test. Record device model, OS version, Expo/development build version, and result. These checks are a checklist, not a claim that the devices have already been tested.

- [ ] First launch shows three example groceries and an empty note.
- [ ] Blank/whitespace-only names cannot be added.
- [ ] Add a long grocery name and a quantity such as `2 cartons`; text remains readable.
- [ ] Leaving quantity blank creates quantity `1`.
- [ ] Mark bought, mark unbought, remove one item, and clear bought items.
- [ ] Remove every item, wait for “Saved on this phone,” close/reopen; examples do not return.
- [ ] Edit the note, switch tabs, wait for saved status, close/reopen; text survives.
- [ ] Airplane mode does not prevent local edits or reopening cached data.
- [ ] Save errors are visible and Retry attempts another write without dropping in-memory changes.
- [ ] If local storage is unavailable or invalid, loading fails visibly without replacing the stored data.
- [ ] Software keyboard does not cover the active form/note on either platform.
- [ ] Small screens and large system text do not hide the add button or delete controls.
- [ ] VoiceOver/TalkBack announces labels, checkbox state, tabs, and save status.
- [ ] Touch targets work comfortably with one thumb.
- [ ] The grocery preview clearly says changes stay on the current phone; there is no false “synced” status.

The independent local preview debounces saving by 300 ms. Wait for its saved status before termination. The shared household uses milestone 3's atomic durable cache/outbox, described in [OFFLINE.md](OFFLINE.md).

## Connected MVP: hosted/device acceptance

Milestones 2 and 3 provide shared online edits and durable offline replay. Run these checks against a configured project and actual phones; local SQLite/PostgreSQL tests do not establish native runtime or Realtime delivery.

- [ ] Apply both migrations and verify shared tables are enabled in the Realtime publication.
- [ ] Use the shared screen on both devices; a new household starts with an empty shared list/note, not local preview examples.
- [ ] Edit a grocery's quantity on one device and title on the other; independent fields merge without a whole-record overwrite.
- [ ] Concurrent same-field grocery edits show a conflict and retain the edit form for review.
- [ ] Concurrent note changes show both the latest server text and the local draft. “Keep mine” uses the latest revision and can conflict again safely.
- [ ] Drop a write response after the server commits; retry uses the same operation ID and does not duplicate or reverse the edit.
- [ ] Drafts and queued edits survive returning to settings, closing the account screen, and force-stop/restart. Explicit sign-out/account switch warns before purging local data.
- [ ] A transient identity lookup failure does not discard the active shared draft. Confirmed access loss removes household data.
- [ ] Verify native keyboard, Android Back, close confirmations, large text, and screen-reader labels on the new shared screens.
- [ ] Open household online, go offline, add/edit/delete several groceries and save a note, force-stop/reopen, reconnect, and verify both phones converge.
- [ ] Expire the session offline; cached data opens with saved-data labels, replay pauses, and same-user reauthentication resumes it.
- [ ] Remove/re-invite a member while they have pending edits: identity-level membership changes quarantine them; rejoining does not silently submit rejected work.
- [ ] Export rejected own edits: no cached server note, conflict copy, other-member record, or token appears.
- [ ] Inject low-storage/open failures and lost acknowledgements; no optimistic edit appears before durable commit, and retries do not duplicate accepted writes.
- [ ] Sign out during a delayed database open/write; old callbacks cannot recreate purged data. Test account/project/household isolation.
- [ ] Use one active browser preview tab per scope; native Android/iOS remain the offline acceptance targets.

| Scenario                                                | Expected result                                                        |
| ------------------------------------------------------- | ---------------------------------------------------------------------- |
| iPhone adds an item while Samsung watches               | Item appears without manual refresh                                    |
| Samsung marks an item bought                            | Both devices converge on bought state                                  |
| Two users edit different groceries                      | Both changes survive                                                   |
| Two users edit different fields of one grocery          | Fields reconcile without overwriting unrelated data                    |
| Two users edit the note from the same revision          | A conflict preserves both drafts                                       |
| Device is offline, adds groceries, then restarts        | Pending edits survive and sync once                                    |
| Server accepts an operation but acknowledgement is lost | Retry does not duplicate or reverse it                                 |
| One phone deletes while another edits offline           | Reconnect does not resurrect the item                                  |
| Background the app, edit on another phone, resume       | Missed changes are fetched                                             |
| Session expires while offline                           | Cached data remains scoped; reauthentication resumes authorized writes |
| Member is removed while offline                         | Later writes are rejected; stale access/cache is handled explicitly    |
| User guesses another household ID or forges a write     | Server rejects the request                                             |
| Expired/revoked/redeemed invite is reused               | Server rejects it atomically                                           |
| Sign out, then sign in as another person                | No prior account's groceries or notes are exposed                      |
| Delete an account or leave as the last owner            | Agreed ownership/retention rules apply consistently                    |

Test Samsung both with normal settings and power saving enabled. Treat background Realtime disconnections as expected; foreground reconciliation must restore correctness. Add automated backend and sync tests as those milestones are implemented.
