# Testing checklist

## Automated checks available now

```sh
npm ci
npm run check
npm run build
```

The tests cover stored-data validation, empty-list preservation, item-input normalization, duplicate-ID handling, and shopping operations preserving the household note. Type checking and Metro export catch integration/bundling issues. These checks do not establish native runtime compatibility or remote sync correctness.

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
- [ ] The UI clearly says changes stay on the current phone; there is no false “synced” status.

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
