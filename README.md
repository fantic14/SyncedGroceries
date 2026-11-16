# Synced Groceries

A phone app for students living together: one grocery list and a place for kitchen reminders, shared across iPhone and Android, with Samsung phones as the main Android test target.

Built with **Expo, React Native, and TypeScript**. The same app code targets both mobile operating systems. The web version is a convenient development preview.

## Current status

This is the **local starter**, not the connected MVP yet.

- Add groceries with a quantity, mark them bought, remove items, and clear bought items.
- Write a household note; changes save automatically.
- Lists and notes persist on the current device using AsyncStorage.
- Three example groceries appear on first launch only. Remove them to start your own list.
- Save failures are shown with a retry action. Unreadable saved data is not silently replaced.

**Accounts, invitations, and cross-device synchronization are not implemented.** Nothing is sent to a backend. Removing the app or clearing its storage removes the local data. See the [initial project plan](docs/PLAN.md) for the connected MVP and release milestones.

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
npm run check     # TypeScript, domain/data-validation tests, formatting
npm run build     # Export JS and assets for Android, iOS, and web
```

`npm run build` checks bundling; it does **not** compile or sign an APK/IPA. Before calling a mobile feature ready, test it on both operating systems using the [device checklist](docs/TESTING.md).

Dependency audit note (2026-11-16): npm reports a moderate [minimatch glob-matching advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249) through Expo's fingerprint tooling. The installed packages match Expo's compatibility requirements. Recheck on Expo patch updates; npm's suggested forced downgrade to SDK 52 is not a compatible fix for this project.

## Native builds

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

No Expo project, backend, signing credentials, or store listing has been created by this initialization. See the official [Expo build guide](https://docs.expo.dev/build/introduction/) for distribution details.

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
docs/PLAN.md                    Scope, architecture, milestones, acceptance criteria
docs/TESTING.md                 Phone testing and future sync scenarios
```

Keep domain rules separate from the UI. Introduce authentication and a remote data layer in the next milestone; do not make screens call backend APIs directly. The starter's local snapshot storage will need a transactional cache and operation queue before promising reliable offline sync.
