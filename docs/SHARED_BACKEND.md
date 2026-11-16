# Shared groceries and notes backend

Milestone 2 adds the shared online data boundary on top of the identity schema. For a new project, apply `supabase/migrations/202611160002_shared_groceries.sql` after the identity migration, using the reviewed migration workflow described in [BACKEND.md](BACKEND.md). Both migrations are already applied to the development project in [DEPLOYMENT.md](DEPLOYMENT.md); do not reapply them manually.

## Records and access

- `grocery_lists` provisions one list per household. Existing households are backfilled; newly created households get a list and note in their creation transaction.
- `grocery_items` contains the title, free-text quantity, explicit bought state, server timestamps, creator/updater IDs, positive revision, and optional deletion timestamp. Titles are trimmed to 1–120 characters and quantities to 1–40.
- `household_notes` contains one note per household, starting empty at revision 1. Body text is at most 2000 characters; whitespace is preserved.
- Shared tables allow member-scoped SELECT under RLS. Direct client INSERT/UPDATE/DELETE is revoked. Private operation results are not client-readable.
- Every RPC checks the authenticated actor exists and locks/rechecks the **explicitly requested household**. An old screen cannot accidentally write into a different household after a user leaves and joins another one. Membership removal and writes serialize on the same household row.
- Creator/updater foreign keys become null when their Auth account is deleted; household content remains available to other members. Deleting the household removes its list, items, note, and operation history.

## RPC contract

All parameters below are named exactly as the client sends them. All functions are restricted to `authenticated`, use an empty `search_path`, and derive the actor from `auth.uid()`.

| RPC                                                                                                       | Result                                                              |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `get_shared_household(household_id uuid)`                                                                 | `{items: SharedItem[], note: SharedNote}`; includes item tombstones |
| `mutate_grocery(operation_id uuid, household_id uuid, item_id uuid, base_revision bigint, changes jsonb)` | `{status: 'applied' \| 'conflict', item: SharedItem \| null}`       |
| `save_household_note(operation_id uuid, household_id uuid, base_revision bigint, body text)`              | `{status: 'applied' \| 'conflict', note: SharedNote}`               |

`SharedItem` fields are `id`, `title`, `quantity`, `completed`, `created_by`, `updated_by`, `created_at`, `updated_at`, `revision`, and `deleted_at`. Attribution IDs and the deletion timestamp may be null. `SharedNote` fields are `id`, `body`, `updated_by`, `updated_at`, and `revision`.

### Grocery changes

Insert a new client-generated item UUID with `base_revision = 0` and a patch containing `title` and `quantity`; `completed` is optional and defaults to false. Existing items accept any nonempty combination of `title`, `quantity`, and explicit boolean `completed`, provided `base_revision` matches the current server revision.

Delete with **only** `{ "deleted": true }`. `deleted: false` and mixed delete/edit patches are rejected. Deletion increments the revision and retains a tombstone. All later edits or inserts using that UUID conflict; there is no undelete endpoint.

A stale revision returns the current record without modifying it. A missing item returns a conflict with `item: null`. Guessing an item UUID from another household never returns that record. The client can rebase non-overlapping fields against the conflict record; overlapping changes require an explicit choice rather than a whole-record overwrite.

### Note changes

Saving checks the note's server revision. On conflict, the result includes the current server note while leaving its text unchanged. The client retains the rejected local draft so the user can choose how to resolve it. An empty body is a valid saved note.

### Retry semantics

Each accepted operation is recorded privately under `(user_id, operation_id)` with its exact request and response. Retrying the same operation ID and payload returns its original response without applying the change twice. Reusing an ID for a different payload or operation kind is rejected. Authorization is checked **before** a replay result is returned, so removal cannot be bypassed with an old operation ID.

Conflict responses are not persisted as accepted operations. A rebased/resolved edit should use a new operation ID. An old accepted retry can return an older revision than a later live update; clients must not replace a newer record with that old acknowledgement. Operation history and tombstones are currently retained without compaction; retention policy belongs with the durable offline/outbox design before public release.

## Realtime setup

When `supabase_realtime` exists, the migration adds `public.grocery_items` and `public.household_notes` to it without duplicating existing publication entries. Check those tables are enabled in the hosted project's publication settings. An empty publication is not created in the embedded test environment.

Subscribe by `household_id`, reconcile a full snapshot after subscription and on foreground/reconnect, and use events as invalidation signals. RLS protects row reads and normal item deletion is an UPDATE tombstone. Household deletion still cascades hard DELETEs; do not use deleted event payloads as an authorization decision or as a substitute for a fresh authorized snapshot. See Supabase's [Postgres Changes guide](https://supabase.com/docs/guides/realtime/postgres-changes) for publication and deleted-record behavior.

## Tests and acceptance limits

```sh
node --test --test-isolation=none tests/database/shared.test.mjs
```

The test harness runs both actual migrations in PGlite PostgreSQL and switches between real `authenticated`/`anon` roles. It checks provisioning, household isolation, direct-write denial, revisions/conflicts, idempotent retries and payload misuse, deletion tombstones, note conflicts, validation rollback, member-removal replay denial, and nullable attribution after account deletion.

It does not test hosted JWT verification, PostgREST serialization, Realtime delivery, native phone behavior, or independent concurrent connections. Lock ordering was reviewed, but production-like multi-connection race testing remains a hosted acceptance check. Milestone 3 now adds the [durable cache/outbox](OFFLINE.md) on the client; it needs no additional cloud migration.
