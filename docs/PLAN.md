# Initial project plan

## Product goal

Students sharing a flat should be able to open their phone, see what the household needs, add groceries or a kitchen reminder, and trust that their flatmates will see the same information.

**Primary platforms:** iOS and Android. Samsung Galaxy devices running One UI are the primary Android hardware target; use standard Android APIs so other Android manufacturers work too.

**First-release success scenario:** one student creates a household, another joins on a different operating system, and both can update the same grocery list and household note. A shopping trip with poor connectivity must not lose edits.

## Starting assumptions

- English first, with localisable UI strings as the product grows.
- One household, one active grocery list, and one plain-text household note per user in the MVP.
- All current household members can view and edit groceries and notes. The owner manages invitations and membership.
- Quantities are free text, such as `2 cartons` or `500 g`; no currency or pricing assumptions.
- The first release needs no contacts, location, camera, or notification permission.
- The app name and identifiers are provisional. These choices can change before distribution.

## MVP scope

| Area            | Required behaviour                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| Identity        | Email sign-in, session restoration, sign-out, account deletion                                          |
| Household       | Create a household, join by invitation, see members, leave; owner can revoke invites and remove members |
| Groceries       | Add, edit, delete, change quantity, mark bought/unbought, clear bought items                            |
| Notes           | Edit one household note, show who changed it and when                                                   |
| Synchronization | Foreground live updates, reconciliation on app resume, clear pending/error states                       |
| Offline use     | Read cached data, queue writes, recover after app restart, replay without duplicate items               |
| Usability       | Accessible touch controls, readable text, working keyboard behaviour and safe areas on both platforms   |

Defer expense splitting, payments, receipts, barcode scanning, push notifications, meal planning, AI features, multiple households, and rich-text collaboration until the core shared list works reliably.

## Technical direction

| Layer                     | Decision                                                                 | Reason                                                                                     |
| ------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Mobile                    | React Native with Expo                                                   | Shared iOS/Android UI and native builds from one codebase                                  |
| Language                  | TypeScript with strict checks                                            | Builds on the existing project and keeps domain contracts explicit                         |
| Current storage           | Versioned AsyncStorage snapshot                                          | Small, runnable local prototype without cloud accounts                                     |
| Proposed backend          | Supabase Auth, Postgres, Realtime                                        | Managed identity, relational household membership, live changes, row-level access controls |
| Connected offline storage | SQLite cache and durable operation outbox                                | Atomically save an edit and its pending operation, recover safely after termination        |
| Distribution              | Expo development/preview builds, then TestFlight and Google Play testing | Test native behaviour before store release                                                 |

Supabase is now the implemented identity/household backend dependency. The schema and client flow are ready for a development project; no hosted project or email service is configured in this workspace. Its Realtime service is not an offline synchronization engine: reconnection, caching, conflict handling, and durable retries must be built explicitly. The local grocery hook/reducer are intentionally small; they are not that sync engine.

References: [Expo project setup](https://docs.expo.dev/get-started/create-a-project/), [Supabase's Expo integration](https://supabase.com/docs/guides/getting-started/tutorials/with-expo-react-native), [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security), [Expo builds](https://docs.expo.dev/build/introduction/).

## Planned cloud data model

Identity, household, membership, invitation, and private invitation-attempt tables are implemented in the [initial migration](../supabase/migrations/202611160001_household_identity.sql). Grocery/note/operation tables below remain a design sketch for the next milestones.

| Entity               | Core fields                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------ |
| `profiles`           | Auth user ID, display name                                                                                   |
| `households`         | ID, name, owner ID, creation time                                                                            |
| `household_members`  | Household ID, user ID, role, join time; unique membership                                                    |
| `household_invites`  | ID, household ID, token hash, expiry, redeemed/revoked state, creator                                        |
| `grocery_lists`      | ID, household ID, name; one active list initially                                                            |
| `grocery_items`      | UUID, list ID, title, quantity, completed, creator/updater IDs, server timestamps, revision, deletion marker |
| `household_notes`    | ID, household ID, body, updater ID, server timestamp, revision                                               |
| `applied_operations` | Operation UUID, user ID, result/revision; deduplicates retried writes                                        |

Local-only tables will track the cached records, last reconciliation cursor, and an outbox containing operation UUID, record UUID, intended changes, base revision, and retry state.

Use client-generated UUIDs for new records and operations. Use server-generated timestamps/revisions for ordering accepted updates; device clocks must not determine conflict winners. Add constraints for text lengths, roles, uniqueness, and references in the database as well as in the app.

## Access and synchronization rules

- Protect every household-owned table with membership-based row-level security. A public mobile API key is not authorization. No service-role credentials go into the app.
- Create households, redeem invitations, transfer ownership, remove members, and delete accounts through server-controlled transactions. Membership writes must not let a user add themselves to an arbitrary household or promote themselves.
- Invitation tokens must be unguessable, expire, and support revocation. Store token hashes; redeem atomically and rate-limit attempts. Reject non-members even if they guess a household ID.
- Cache locally and update the visible UI immediately. Persist the change and its outbox operation in one SQLite transaction before considering it queued.
- Send explicit intent, such as `completed = true`, rather than replaying a `toggle`. Deduplicate operation IDs so retries cannot apply a change twice.
- Reconcile on launch, reconnect, and foreground resume. Realtime events accelerate updates; they do not replace fetching missed changes. Subscribe and reconcile without leaving a gap between initial loading and live events.
- Use server revisions for concurrency checks. Edits to separate items merge independently. On the same item, rebase non-overlapping fields; do not blindly overwrite a newer whole record.
- Keep deletion tombstones until clients can reconcile them, so stale offline edits cannot resurrect removed groceries.
- If two people edit the note at the same revision, retain the rejected local draft and offer a conflict choice. Silent loss of a household note is not acceptable. Rich-text/character-level merging is outside the MVP.
- Show `offline`, `pending`, `synced`, and `failed` states based on actual cache/outbox/connection state. Never label an optimistic local edit as remotely synced before acknowledgement.
- On sign-out, household removal, or account switching, stop subscriptions and isolate/clear user-scoped cached data. Decide how to handle unsubmitted changes visibly, without leaking them into another account.

## Milestones and acceptance criteria

### 0. Initialize the project — implemented

- Expo/React Native/TypeScript configuration for iOS, Android, and a browser preview.
- Grocery checklist, quantity input, deletion/clear-bought controls, and a household note.
- Local persistence with hydration protection, ordered saves, validation, error messages, and retry.
- Type checks, domain tests, formatting scripts, build profiles, and setup documentation.

This milestone demonstrates local interactions. It does not demonstrate sharing, native build success, or phone compatibility; those require the later checks below.

### 1. Identity and household boundaries

**Status: implementation ready; hosted and phone acceptance checks pending.** Email OTP sign-in, native encrypted session persistence, create/join, owner invitation/member management, ownership transfer, leaving, and self-account deletion are implemented. The actual migration passes PostgreSQL/RLS tests locally. See [backend setup](BACKEND.md) to configure a project, apply the migration, and enable numeric-code emails. OTP entry avoids a redirect/deep-link dependency for this authentication flow.

- Set up the Supabase development project and version-controlled database migrations.
- Add email authentication, secure session persistence, and mobile deep-link handling where required by the selected email flow.
- Implement household creation, owner-managed membership, and expiring invitation redemption.
- Test row-level security with two households, signed-out requests, removed members, and attempts to write forged household/user IDs.

**Done when:** two test accounts can join one household, and neither can read or modify a different household's records through direct API requests.

### 2. Connected groceries and notes

- Introduce a repository/service layer backed by the cloud schema.
- Add item editing and edit attribution. Connect the household note.
- Add foreground Realtime subscriptions, resume reconciliation, and visible connection errors.
- Implement server revisions, idempotent operations, and note conflict handling.

**Done when:** an iPhone and a Samsung phone in the same household see each other's online changes without manual refresh, and concurrent edits do not silently discard note text.

### 3. Reliable offline use

- Replace the starter snapshot adapter with the SQLite cache/outbox.
- Queue edits durably, recover them after restart, and retry with bounded backoff.
- Add network/resume handling, tombstone reconciliation, and pending/failed operation UI.
- Verify expired sessions and revoked membership during an offline shopping trip.

**Done when:** both phones can make edits offline, restart, reconnect, and reach the same final list without duplicate items or resurrected deletions. Rejected edits remain understandable and recoverable.

### 4. Household pilot and mobile polish

- Exercise the app with a small student household using real grocery trips.
- Check Samsung keyboard/back navigation, One UI background restrictions, iOS safe areas, VoiceOver/TalkBack, and large text.
- Finalise icons, splash screen, app identifiers, privacy copy, support contact, and account/household deletion behaviour.
- Produce installable preview builds and run the [device checklist](TESTING.md).

**Done when:** the pilot household can complete a grocery trip on both operating systems and the critical sync/recovery scenarios pass on actual devices.

### 5. Release

- Configure owned Expo/store projects and signing credentials.
- Distribute through TestFlight and Google Play internal/closed testing before a public release.
- Complete store privacy declarations and retention/deletion behaviour based on the final backend.
- Fix pilot defects and record supported OS/device versions based on the SDK and tested builds.

**Done when:** signed store test builds install and pass the same acceptance scenarios as development builds.

## Next concrete task

Configure the Supabase development project using [BACKEND.md](BACKEND.md), then verify email delivery/session restoration and a two-account create/invite/join flow through the hosted API. Record iPhone/Samsung results before marking milestone 1 complete. Next, implement milestone 2's shared grocery/note schema and repository, keeping the local preview separate unless the user explicitly imports it.

The chosen authentication flow is numeric email OTP. The backend project and region still require configuration. The local preview and SQL tests work without credentials.
