# Identity and household backend

Milestone 1 adds the database boundary for accounts and households. Milestone 2 adds a separate online shared list/note described in [SHARED_BACKEND.md](SHARED_BACKEND.md); the original local preview remains independent. This repository does not include a deployed Supabase project or credentials.

## Connect a development project

For account creation through a standalone Android installer, use the [first Android testing walkthrough](ANDROID_TESTING_SETUP.md). It includes the email template, read-only hosted verification, and Expo setup.

1. Create a Supabase development project in the appropriate region for the household. Keep production and development projects separate.
2. Apply `supabase/migrations/202611160001_household_identity.sql`, then `202611160002_shared_groceries.sql`, as the database owner. The migrations are transactional and expect Supabase's existing `auth.users`, `auth.uid()`, `anon`, and `authenticated` objects. Apply each exactly once.
3. Enable email authentication. Configure the **Magic Link email template** to show `{{ .Token }}` so users can enter the email code in the app. This implementation uses email OTP verification rather than a browser redirect, so it does not require a magic-link callback/deep link.
4. Copy `.env.example` to `.env.local`. Set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from the project's Connect dialog. Only a public/publishable key belongs in the mobile app. Never use a secret or service-role key.
5. Restart the Expo server after changing environment variables. Use two real test accounts to check the create/invite/join flow against the hosted Auth and API services.

Configure email delivery/SMTP and provider rate limits for your intended test recipients. The app expects a numeric OTP in the email, not a clickable magic-link-only template. See Supabase's [email OTP guide](https://supabase.com/docs/guides/auth/auth-email-passwordless).

For version-tracked CLI deployment, use the pinned CLI and tracked local configuration. Authenticate, link the development project, review the migrations, and push explicitly to the remote target (CLI 3 defaults to local):

```sh
npm run supabase -- login
npm run supabase -- link --project-ref YOUR_DEVELOPMENT_PROJECT_REF
npm run supabase -- db push --remote --dry-run
npm run supabase -- db push --remote
```

Use a single migration workflow so CLI migration history matches deployed state; do not manually apply these files in SQL Editor and then push them again. Run [verify.sql](../supabase/verify.sql) in SQL Editor after deployment for read-only table/RLS, RPC-grant, and Realtime checks. The tracked local `config.toml` does not configure hosted Auth or SMTP when migrations are pushed. Do not put database passwords or Auth administrator credentials into Expo variables.

Supabase's [Expo guide](https://supabase.com/docs/guides/getting-started/tutorials/with-expo-react-native), [row-level security guide](https://supabase.com/docs/guides/database/postgres/row-level-security), and [database-function guidance](https://supabase.com/docs/guides/database/functions) describe the underlying integration and privileges.

## API contract

Every RPC requires the `authenticated` role, uses the verified caller's `auth.uid()`, and has an empty `search_path`. No operation accepts a caller-supplied actor/user ID. Target member IDs are checked against the caller's current household.

| RPC                                                   | Result and behaviour                                                                            |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `get_my_household()`                                  | Zero or one row: `id`, `name`, `owner_id`, `created_at`                                         |
| `get_household_members()`                             | Current household members: `user_id`, `display_name`, `role`, `joined_at`                       |
| `create_household(household_name, display_name)`      | New household UUID; creates owner membership atomically                                         |
| `create_household_invite()`                           | Owner only; returns `id`, one-time visible `token`, `expires_at`                                |
| `redeem_household_invite(invite_token, display_name)` | Joined household UUID or `null` on generic rejection                                            |
| `get_household_invites()`                             | Owner-only metadata: `id`, `expires_at`, `revoked_at`, `redeemed_at`; no token/hash             |
| `revoke_household_invite(invite_id)`                  | Owner only; revokes an invite in the caller's household                                         |
| `remove_household_member(member_id)`                  | Owner only; removes another member, immediately revoking their database access                  |
| `transfer_household_ownership(member_id)`             | Owner only; promotes a current member, demotes self, revokes unused invitations                 |
| `leave_household()`                                   | Leaves as a member; sole owner's empty household is deleted; otherwise requires transfer first  |
| `delete_my_account()`                                 | Deletes only the authenticated Auth user and profile, after applying the same leave/owner rules |

Household names must contain 1–80 characters after trimming; display names 1–60. A user may belong to at most one household. Account deletion removes that account's personal records; its redeemed invite metadata may remain with the household without the deleted user's ID. Future shared-grocery migrations must define retention and attribution rules explicitly.

## Invitation rules

- Each invite is single use and expires after 48 hours.
- Tokens contain 64 lowercase hexadecimal characters. They are SHA-256 outputs over three independently generated PostgreSQL secure UUIDs, providing a 256-bit token space. The database stores only a separate SHA-256 hash of the token.
- The raw token is returned only when issued; it cannot be recovered later. Create another invite if it is lost.
- Each signed-in user gets at most 10 redemption attempts in a 15-minute window. Invalid, expired, revoked, consumed, malformed, already-in-a-household, and rate-limited cases all return `null`. Do not turn invalid attempts into raised SQL exceptions: that would roll back the attempt counter.
- Owners may have at most five unexpired, unused invitations and issue at most 20 invitations per hour. Revoking an invite frees an active slot but does not erase the hourly issue count.
- Household and invitation locks serialize owner changes and single-use redemption. This is an account-level limiter, not a substitute for provider-level signup/email/IP abuse controls before public release.

## Data-access boundary

`profiles`, `households`, and `household_members` allow authenticated SELECT through membership-based RLS. There are no direct client INSERT, UPDATE, or DELETE grants. Neither `household_invites` nor the private attempt-counter table is readable by clients. All mutations go through restricted database functions, preventing forged household membership or owner promotion.

The private membership lookup avoids recursive membership policies. Its only client-executable helper returns the caller's current household ID. Internal locking helpers have no public/client execute permission. The owner-only and self-account functions use server transactions; client optimism is not used to authorize writes.

Deleting an Auth user does not magically invalidate every previously issued JWT. Membership/profile deletion removes the data scope immediately, and mutation RPCs verify that the actor still exists. Auth service behavior, session revocation, and email delivery must also be checked in the hosted integration test.

## Executable database tests

```sh
node --test --test-isolation=none tests/database/*.test.mjs
```

The harness runs the actual migration in **PGlite PostgreSQL** and switches to `authenticated`/`anon` roles before asserting access. It substitutes only a minimal Auth user table and JWT-to-UID function. It checks two-household isolation, signed-out denial, forged direct writes, invitation hashing/expiry/revocation/single use, persistent redemption throttling, owner authority, member removal, ownership transfer, and self-account deletion.

These tests require no cloud account or Docker. They exercise SQL, grants, and row-level security; they do not test JWT signature verification, Supabase Auth email/session endpoints, PostgREST behavior, or concurrent independent connections. Run the two-device/hosted acceptance checklist before marking the whole milestone complete.
