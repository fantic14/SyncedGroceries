# Synced Groceries

A phone app for students living together: one grocery list and a place for kitchen reminders, shared across iPhone and Android, with Samsung phones as the main Android test target.

Built with **Expo, React Native, and TypeScript**. The same app code targets both mobile operating systems. The web version is a convenient development preview.

## Current status

The local preview, identity/households, shared groceries/notes, and **milestone 3 durable offline cache/replay** are implemented. The Supabase development schema is deployed, and the first signed Android preview APK has built successfully. Signed-in flows and phone acceptance testing are still pending; see the [deployment record and installer](docs/DEPLOYMENT.md).

- Add groceries with a quantity, mark them bought, remove items, and clear bought items.
- Write a household note; changes save automatically.
- Lists and notes persist on the current device using AsyncStorage.
- Three example groceries appear on first launch only. Remove them to start your own list.
- Save failures are shown with a retry action. Unreadable saved data is not silently replaced.

Open **Household & account** to use email-code sign-in, create or join a household, view members, and manage invitations. Owners can revoke invitations, remove members, and transfer ownership. Members can leave, and users can sign out or delete their account with confirmation. These features require a configured Supabase development project; follow the [backend setup guide](docs/BACKEND.md).

After joining a household, open **shared groceries & note** to add/edit groceries, mark them bought, remove them, and save a shared note. Realtime subscriptions and foreground/periodic reconciliation fetch authorized snapshots. Grocery edits use server revisions; independent-field edits can merge, while conflicting note text is preserved for an explicit choice. See the [shared backend setup](docs/SHARED_BACKEND.md) and apply both migrations in order.

**The local preview stays separate** and is never uploaded automatically. Shared edits/drafts now persist in native SQLite (IndexedDB in the browser preview), survive restart, and replay after reconnecting. Open the household online once before using it offline. Note typing saves a local draft; Save household note queues it for the household. Explicit sign-out/account switching removes that account's local records after a warning. See [offline behaviour and limitations](docs/OFFLINE.md).

Without `.env.local`, the local preview works and household setup explains that sharing is not connected. With valid public Supabase configuration, identity and membership requests go to that project. The development project has both migrations applied; public configuration remains outside Git and is set separately in Expo's preview environment.

## Run locally

Use Node.js 24 LTS and npm. The project includes `.nvmrc` if you use nvm.

```sh
nvm use
npm ci
npm start
```

The project uses **Expo SDK 58**. Use a matching Expo Go build for a quick preview where available, or create a development build. Expo Go compatibility changes independently of this repository; check the [Expo Go download page](https://expo.dev/go) and [version mismatch guide](https://docs.expo.dev/troubleshooting/expo-go-version-mismatch/) for your device. Depending on the installed Expo tooling, `npm start` may target the development client because `expo-dev-client` is installed; press `s` in the terminal to switch targets, or run `npm start -- --go` for Expo Go.

### Samsung / Android

1. Connect the phone and development computer to the same Wi-Fi.
2. Start the server and scan its QR code using a compatible Expo Go or installed development build.
3. Alternatively, start an Android emulator and run `npm run android`.

If the local network blocks connections, try `npm start -- --tunnel` (the Expo CLI may request an additional tunnel package). A development build must be installed on the phone before it can open a development-client QR code.

### iPhone / iOS

Open the project using a compatible Expo Go build or a signed development build. Follow Expo's [physical iOS setup guide](https://docs.expo.dev/get-started/set-up-your-environment/?device=physical&platform=ios); account and signing requirements depend on the chosen workflow. Follow any Expo Go sign-in prompt using the same Expo account in the CLI and on the phone.

`npm run ios` opens an iOS simulator **on macOS with Xcode installed**. On Linux or Windows, test on a physical iPhone using Expo Go or a cloud-built development app. Native iOS builds require macOS locally or Expo's cloud build service.

### Browser preview

```sh
npm run web
```

The browser preview does not replace testing on actual phones.

## Checks

```sh
npm run check     # TypeScript, unit + SQLite + PostgreSQL tests, formatting
npm run test:db   # Actual migration and RLS tests; no Docker/cloud needed
npm run build     # Export JS and assets for Android, iOS, and web
```

`npm run build` checks bundling; it does **not** compile or sign an APK/IPA. Before calling a mobile feature ready, test it on both operating systems using the [device checklist](docs/TESTING.md).

Dependency audit note (2026-11-16): npm reports a moderate [minimatch glob-matching advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249) through Expo's fingerprint tooling. The installed packages match Expo's compatibility requirements. Recheck on Expo patch updates; npm's suggested forced downgrade to SDK 52 is not a compatible fix for this project.

## Native builds

For the first hosted backend and standalone Samsung APK, follow [the Android testing setup](docs/ANDROID_TESTING_SETUP.md). It covers account creation, migration deployment, email-code delivery, Expo environment variables, signing, installation, and acceptance checks.

`eas.json` includes development, preview, and production profiles. The development profile uses `expo-dev-client`; the preview profile produces an installable Android APK.

Before the first cloud build:

1. Choose final app identifiers in `app.json`. `com.syncedgroceries.app` is provisional; it does not assert ownership of a domain or store listing.
2. Sign in to Expo and link the project with `npx eas-cli@latest build:configure`. Review generated settings before committing them.
3. Configure the required signing credentials. Physical iOS distribution requires Apple provisioning and a suitable developer account.

Then, for example:

```sh
npx eas-cli@latest build --profile development --platform android
npx eas-cli@latest build --profile development --platform ios
npx eas-cli@latest build --profile preview --platform android
```

The development Supabase and Expo projects are linked, with an Android signing keystore managed by Expo. No store listing or iOS signing setup has been created. See the [deployment record](docs/DEPLOYMENT.md) and official [Expo build guide](https://docs.expo.dev/build/introduction/) for distribution details. Rebuild native development clients after adding native modules such as SecureStore; an older installed development client will not include them.

## Project layout

```text
App.tsx                         App root and safe-area provider
src/index.ts                    Expo entry point
src/theme.ts                    Shared colours
src/features/household/
  HouseholdScreen.tsx           Grocery and note screens
  state.ts                     Types, item rules, reducer, saved-data validation
  storage.ts                   Versioned local persistence adapter
  useHousehold.ts               Hydration, actions, ordered writes, save status
  state.test.ts                 Domain and stored-data tests
src/features/identity/          Email-code sign-in, household UI, hook and RPC service
src/features/shared/            Shared groceries/note UI, repository, revision-aware store
src/features/offline/           SQLite/IndexedDB storage, durable outbox, recovery and replay tests
src/lib/                        Backend configuration and secure session storage
supabase/migrations/            Transactional household schema, RPCs, RLS, grants
tests/database/                 PostgreSQL access-control and invitation tests
docs/BACKEND.md                 Hosted project setup, API contract, security boundaries
docs/SHARED_BACKEND.md          Shared-data migrations, Realtime setup and retry rules
docs/OFFLINE.md                 Offline behaviour, recovery and device acceptance
docs/PLAN.md                    Scope, architecture, milestones, acceptance criteria
docs/TESTING.md                 Phone testing and future sync scenarios
```

Keep domain rules separate from the UI. Native sessions use encrypted SecureStore; browser sessions are tab-scoped. Shared records/outbox are scoped to backend, user, and household. Auth never falls back to plaintext AsyncStorage. HTTP is accepted only on loopback for local development; hosted endpoints need HTTPS. Use one active browser tab per household; phones remain the primary target.

Milestones 2 and 3 and the Android test setup are merged into `master`. See [CONTRIBUTING.md](CONTRIBUTING.md) for feature branches and focused commits.
