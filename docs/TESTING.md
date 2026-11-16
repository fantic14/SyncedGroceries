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

Saving is debounced by 300 ms. Abrupt process termination before storage acknowledges a write can lose that last edit; wait for saved status when testing persistence. Durable transactional offline writes belong to milestone 3.

## Connected MVP: scenarios to add

These are future acceptance tests; the local starter cannot pass them yet.

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
