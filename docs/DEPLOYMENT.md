# Development deployment and first Android build

Recorded November 16, 2026. This is a development environment, not a store release. Identifiers and URLs below are public metadata; credentials and signing keys are not recorded here.

## Supabase

| Setting            | Value                                      |
| ------------------ | ------------------------------------------ |
| Project            | `synced-groceries-dev`                     |
| Project reference  | `kqlbkggcxmuuishcsnqb`                     |
| URL                | `https://kqlbkggcxmuuishcsnqb.supabase.co` |
| Region             | `eu-west-1`                                |
| Database           | PostgreSQL 17                              |
| Applied migrations | `202611160001`, `202611160002`             |

The migrations were deployed through Supabase CLI 3.1.0 after a dry run against this project. CLI output calls the project's main environment `production`; this is the main database of the project named `synced-groceries-dev`, not a separate production app environment.

Hosted read-only checks passed:

- All nine expected tables exist with RLS enabled.
- All fourteen app RPCs exist, allow `authenticated`, and deny `anon` execution.
- `grocery_items` and `household_notes` are in `supabase_realtime`.
- The public app key reaches Auth settings (HTTP 200); email authentication and signups are enabled.
- An unsigned-in `get_my_household` API request is denied (HTTP 401).

The owner reports SMTP and numeric-code email templates configured. Actual delivery, first/returning sign-in, and signed-in authorization remain to be tested through the app. The Resend test sender can deliver only to the email associated with that Resend account until an owned domain is verified; see the [setup guide](ANDROID_TESTING_SETUP.md).

## Expo and Android

| Setting                    | Value                                                 |
| -------------------------- | ----------------------------------------------------- |
| Expo owner/project         | `@fantic14/synced-groceries`                          |
| Project ID                 | `ee0c40a0-0bc8-4ec8-98fb-f7b54381c1c8`                |
| Android application ID     | `com.syncedgroceries.app`                             |
| Preview profile            | Internal distribution, standalone APK                 |
| Runtime configuration      | Node 24.22.1; Expo `preview` environment              |
| App version / version code | `0.1.0` / `1`                                         |
| Signing                    | Generated Android keystore managed by Expo            |
| Build source revision      | `2b9464f`                                             |
| Build ID                   | `676d0e22-a2d0-4d25-9a86-78234376a5cb`                |
| Build result               | Finished successfully, November 16, 2026 at 12:48 UTC |

[Build progress and installation](https://expo.dev/accounts/fantic14/projects/synced-groceries/builds/676d0e22-a2d0-4d25-9a86-78234376a5cb).

[Download the APK](https://expo.dev/artifacts/eas/SowRCBZre5P1AtPhiNRNBSUqpLYfLfi9rw8HIue3-g8.apk). The downloaded installer was inspected:

- Package `com.syncedgroceries.app`, version `0.1.0`, version code `1`.
- Minimum Android API 24 (Android 7.0); target API 36.
- File size: 75,424,306 bytes (about 75 MB).
- Embedded app bundle and the intended Supabase endpoint/public configuration are present.
- APK signing block is present; phone installation/runtime acceptance is still required.
- SHA-256: `b0e3942d76ab71f91a956f9c0c64d43b6f0850f9ac5ab7109136a17e65b17a4e`.

Only `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` were copied from the ignored `.env.local` into the project's Expo preview environment. The build uses an embedded app bundle and the hosted backend, so the PC/Metro server is unnecessary after installation.

Local validation before submission: TypeScript, all 91 automated tests, formatting, public backend configuration, and Android/iOS/web bundle exports passed. The real CLI dry run also validated the root-relative email-template file paths. Generated Supabase cache files are excluded from formatting and Git.

## Acceptance still required

- Install the APK on the Samsung phone and record model, Android version, and One UI version.
- Receive an email code, sign in, create a household, and use the shared screen.
- Restart after offline grocery/note edits, reconnect, and confirm replay without lost or duplicate work.
- Configure email delivery for a second account, invite it, and verify live updates and conflicts.
- Complete [TESTING.md](TESTING.md) and [OFFLINE.md](OFFLINE.md).
- Configure iOS signing and run the same acceptance on an iPhone.

No store submission or iOS build has been performed.
