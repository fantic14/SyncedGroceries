# First hosted backend and Android APK

This walkthrough connects a Supabase development project and builds a standalone Android preview APK through Expo. The installed APK contains the app code, connects directly to Supabase, and runs with the development PC switched off. Its SQLite cache and queued edits stay on the phone.

Repository preparation does not create either cloud project, deploy migrations, send emails, or produce an APK. Those steps need the accounts below. Keep passwords and private tokens in the provider dashboards or terminal login prompts.

## 1. Create the accounts and Supabase project

1. Create accounts at [Supabase](https://supabase.com/dashboard) and [Expo](https://expo.dev/signup).
2. In Supabase, create a development project named `synced-groceries-dev`. Choose a region near your testers, and save the database password privately. Wait until the project is ready.
3. In the project's **Connect** dialog or **Settings → API Keys**, find the HTTPS Project URL and **publishable** key (`sb_publishable_…`). The project reference is the identifier in the dashboard URL; it is also normally the first part of `https://PROJECT_REF.supabase.co`.
4. Keep the Data API enabled with `public` exposed. Leave `private` out of exposed schemas. The app calls restricted database functions; it does not need direct table-write grants.

| Value                           | Where it belongs                                                           |
| ------------------------------- | -------------------------------------------------------------------------- |
| Project URL and publishable key | Expo's `preview` environment and local `.env.local`; these ship in the app |
| Database password               | Password manager and database CLI prompts                                  |
| Supabase management token       | Supabase CLI login only                                                    |
| SMTP credentials                | Supabase's SMTP settings only                                              |
| Expo password/token             | Expo login only                                                            |

A Google Play developer account and an Apple Developer account are unnecessary for this Android APK workflow. The provisional Android package is `com.syncedgroceries.app`; choose the final owned identifier before store distribution.

## 2. Deploy the two database migrations

Run these in the repository terminal, using Node.js 24. `npm run supabase` uses the CLI version pinned in `package.json`; local CLI configuration is already tracked, so there is no need to run `init` again.

```sh
npm run supabase -- login
npm run supabase -- link --project-ref YOUR_PROJECT_REF
npm run supabase -- db push --remote --dry-run
```

Confirm that the dry run targets your development project and lists exactly these two migrations on a fresh project:

1. `202611160001_household_identity.sql`
2. `202611160002_shared_groceries.sql`

Then deploy them:

```sh
npm run supabase -- db push --remote
```

**Supabase CLI 3 uses a local target by default: keep `--remote` in both commands.** There is no need to start Docker or a local database for this hosted deployment. The CLI can request a database password or an authenticated remote connection, depending on your account and connection setup.

Use this migration workflow consistently. If either migration was already applied manually in SQL Editor, stop and reconcile migration history before pushing it again; both files create objects and must not run twice. Milestone 3 needs no additional cloud migration.

In Supabase **SQL Editor**, paste and run [verify.sql](../supabase/verify.sql). It reads system catalogs only. Expect:

- Nine tables with `table_exists` and `rls_enabled` true.
- Both shared tables with `realtime_enabled` true.
- Fourteen RPCs with `rpc_exists` true, `anon_execute` false, and `authenticated_execute` true.

The second migration adds `grocery_items` and `household_notes` to `supabase_realtime` when that publication exists. If either check is false, inspect the project's Realtime/publication configuration before continuing. Do not disable RLS to work around a connection error.

The SQL Editor is normally the database owner with no signed-in app user. Exercise create/join/edit through the app rather than calling account-bound mutation functions there.

## 3. Configure email codes and delivery

In **Authentication → Sign In / Providers**, enable Email and allow new-user signups. Keep anonymous sign-in disabled. The app creates a user on the first email-code request and verifies the code inside the app.

**Configure custom SMTP before editing the templates.** New free-tier Supabase projects created from June 3, 2026 cannot edit authentication templates while using the default sender. This app needs numeric codes, so the default magic-link email is insufficient. See [Supabase's change notice](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier).

For the first test on your own email address, create a [Resend](https://resend.com) account and a sending API key. Enable custom SMTP in Supabase **Authentication → SMTP Settings** using:

| Setting      | Value                   |
| ------------ | ----------------------- |
| Sender email | `onboarding@resend.dev` |
| Sender name  | `Synced Groceries`      |
| Host         | `smtp.resend.com`       |
| Port         | `465`                   |
| Username     | `resend`                |
| Password     | Your Resend API key     |

Save/enable the SMTP configuration, then return to the email templates. Keep the API key only in Supabase's SMTP password field, never in Expo variables or `.env.local`. These settings come from [Resend's SMTP documentation](https://resend.com/docs/send-with-smtp).

The `resend.dev` test sender can send only to the email associated with your Resend account. Use that exact address for the first app sign-in. Before testing with flatmates or a second account, add a domain you control to Resend, publish its required DNS records, verify it, and change the Supabase sender to an address on that domain. See [Resend's test-domain limits](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain). If you already have another SMTP provider, use its settings and sender-verification requirements instead.

In **Authentication → Email Templates → Magic Link**, use the body from [magic-link.html](../supabase/templates/magic-link.html). It contains:

```html
<p>Enter this code in the app: <strong>{{ .Token }}</strong></p>
```

Use the same code body for **Confirm signup** so the first-account email also contains an enterable code. Set the subject to `Your Synced Groceries sign-in code`. Six-digit codes with the normal 60-second resend cooldown work with the app. No callback URL or mobile deep link is needed for code entry.

Test both the first sign-in and a later sign-in. Flatmates join the app using household invitations; they do not need Supabase dashboard access. See the [SMTP restrictions](https://supabase.com/docs/guides/auth/auth-smtp) and [email OTP guide](https://supabase.com/docs/guides/auth/auth-email-passwordless).

The tracked `supabase/config.toml` and HTML template configure an optional **local** stack. `db push` does not apply these Auth, SMTP, or API settings to the hosted project; configure those in the dashboard as described above.

## 4. Link Expo and set its preview environment

Run these in your own terminal so account credentials stay in the interactive login:

```sh
npm run eas -- login
npm run eas -- whoami
npm run eas -- init
npm run eas -- build:configure --platform android
```

Select your Expo account as the owner and create/link the `synced-groceries` project. `init` writes its real `extra.eas.projectId` into `app.json`; keep that generated ID, and review the configuration diff. The project ID is public metadata. Do not insert a made-up ID.

In the Expo project dashboard, open **Project settings → Environment variables → Add Variables** and create these project-scoped variables in the **preview** environment with **plain text** visibility:

| Name                                   | Value                                 |
| -------------------------------------- | ------------------------------------- |
| `EXPO_PUBLIC_SUPABASE_URL`             | Your HTTPS Supabase Project URL       |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Your project's `sb_publishable_…` key |

The `preview` build profile explicitly selects that environment. Public app values do not become secrets by changing their dashboard visibility; database administrator credentials must never go in these variables.

Download those same values for local checks and previews:

```sh
npm run eas -- env:pull --environment preview --path .env.local
npm run backend:check
```

Review an existing `.env.local` before allowing the pull to replace it. It is ignored by Git. Alternatively, copy `.env.example` to `.env.local` and fill the same two public values manually. A local environment file alone does not configure cloud builds.

`backend:check` validates the public configuration's format and rejects loopback endpoints. It does not prove that the project exists, the key matches it, or migrations/email delivery work. Preview and production cloud builds run this same check before installing dependencies, failing early when the configuration is missing or invalid. Development clients retain an optional backend for local work.

See [Expo environment variables](https://docs.expo.dev/eas/environment-variables/manage/) and [build profile environments](https://docs.expo.dev/eas/environment-variables/usage/).

## 5. Build and install the APK

```sh
npm run check
npm run apk:android
```

This runs `eas build --platform android --profile preview` using the pinned EAS CLI. The profile uses Node 24, internal distribution, an APK output, and no development client. Allow Expo to generate an Android signing keystore if it asks. Preserve that keystore in the Expo account for later updates of the same app.

Open the returned build URL to follow progress. After it succeeds, open its install/download link on the Samsung phone and install the APK. Android can ask you to allow installation from the browser or file app. You do not need Expo Go, a QR connection to Metro, or the Play Store for this build. See [Expo APK distribution](https://docs.expo.dev/build/internal-distribution/).

An export from `npm run build` is a bundling check, not an APK. Record the actual cloud build result before calling the installer ready. Changing embedded Supabase configuration requires a fresh APK for this workflow.

## 6. Verify the first phone run

1. Launch the installed APK with the development server stopped.
2. Open **Household & account**, request a code, and sign in with the intended tester email.
3. Create a household, then open **shared groceries & note**. The initial local preview is separate and does not synchronize.
4. Add, edit, and buy groceries; save a shared note. Close and reopen the app.
5. Open the household online, turn on airplane mode, add several items, and save a note. Force-stop and reopen while still offline, then reconnect. Verify edits survive and synchronize without duplicates.
6. Use a second account on another phone or one browser-preview tab, join using an owner-issued household invitation, and verify live changes in both directions. The browser counterpart needs its own development server while testing; the installed APK does not.

Continue with the full [device checklist](TESTING.md) and [offline checklist](OFFLINE.md). Record failures with device model/OS and the triggering actions; do not include tokens or email codes in reports.

| Acceptance evidence                                  | Current result                        |
| ---------------------------------------------------- | ------------------------------------- |
| Hosted migrations and catalog verification           | Pending account/project configuration |
| Email delivery and first/returning sign-in           | Pending                               |
| Expo project link and preview variables              | Pending                               |
| Successful cloud build URL and tested Git revision   | Pending                               |
| Samsung model, Android/One UI versions, installation | Pending                               |
| Online sync and offline restart/replay               | Pending                               |

References: [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started), [Supabase migrations](https://supabase.com/docs/guides/local-development/database-migrations), [Expo build setup](https://docs.expo.dev/build/setup/).
