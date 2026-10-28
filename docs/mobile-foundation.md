# Mobile foundation — IPM-4, IPM-5, IPM-6, IPM-7

The application uses Expo 58.0.20, React Native 0.88.0, React 19.3.0,
TypeScript 6 and the root universal API of `@expo/ui` 58.0.24. One component
tree in `App.tsx` serves Android and iOS. `src/theme.ts` defines the Sakin palette,
spacing and corner radii. The Accounts screen can change the primary color for
the current demo session.

## Run and validate

Use Node 24 and npm from the repository root:

```sh
npm ci
npm run typecheck
npm test
npm run bundle:android
npm run bundle:ios
npm start
```

Open the app with a compatible Expo Go installation or use `npm run android`
or `npm run ios` with the native SDK installed. iOS native builds require macOS
and Xcode. A cloud task already has its own isolated checkout; use it directly
without creating a worktree.

`EXPO_OFFLINE=1` allows Expo commands to use the installed SDK's bundled module
version table when the Expo metadata API is inaccessible. npm still downloads
packages through the configured registry/proxy with TLS and lockfile integrity
verification. An offline compatibility check does not establish agreement with
the current online React Native Directory.

## Demo behavior

Every screen displays the demo notice. There are no network calls or real
credentials. Tasks, projects, task details, completion/reopening, comments, a
combined source-aware inbox and account-level demo preferences are interactive.
Removing an example account removes its in-memory data. Restarting the app resets
the demo. Preferences do not register or deliver push notifications.

Both example servers deliberately have the same remote user, task and notification
IDs. Identity includes the canonical HTTPS API base URL and user ID. Resource
keys include that account identity and resource kind. Deployment paths are
preserved; URL user info, queries and fragments are rejected.

The storage adapter in `src/storage/secureSessionVault.ts` uses Expo SecureStore
and SHA-256-derived account slots. It is prepared for the auth implementation;
the demo does not create a session. Unit tests exercise the vault contract with
an in-memory storage port. Keychain/Keystore persistence still needs device tests.
The disconnect contract requires successful device revocation before removing
the credential; offline revocation leaves it available for an explicit retry.
There is no device registration endpoint wired into the app yet.

`loadAccounts` runs requests independently with per-account deadlines and abort
signals. The helper and opaque notification-routing resolver are tested domain
foundations; real API loading and OS notification callbacks are not connected.

## CI and artifacts

The `Mobile` workflow performs a clean `npm ci`, compatibility check, typecheck,
12 isolation tests, and separate Android/iOS Hermes bundle exports. Native jobs
depend on that validation job:

- `mobile-platform-bundles`: generated Android/iOS JavaScript and metadata.
- `mobile-android-debug-apk`: Gradle debug APK for arm64 devices and x86_64 emulators.
  This development APK requires Metro (`npm start` and `adb reverse tcp:8081 tcp:8081`
  for a USB-connected Android device). It is not a standalone release binary.
- `mobile-ios-simulator-app`: unsigned simulator `.app` inside a ZIP; install with
  `xcrun simctl install booted <application.app>`. Debug builds require Metro.

Artifacts expire after 14 days. The iOS job uses macOS 26/Xcode; Android uses
JDK 17, API 37 and NDK 27.1.12297006, matching React Native's installed toolchain
metadata. Generated `android/` and `ios/` projects are ignored and recreated by
Expo prebuild. The HTML design artifact workflow remains separate.

## Evidence and limits

Registry `latest` tags and the official Expo SDK 58 documentation source were
checked on 2026-10-28. References:

- [Expo UI universal documentation](https://docs.expo.dev/versions/v58.0.0/sdk/ui/universal/)
- [Official documentation source](https://github.com/expo/expo/blob/sdk-58/docs/pages/versions/v58.0.0/sdk/ui/universal/index.mdx)
- [Expo template](https://www.npmjs.com/package/expo-template-blank-typescript/v/58.0.29)

Local clean installation, typecheck, 12 tests, both platform bundle exports and
native project generation passed. A generated native project is not a compiled
APK or simulator application. Native CI results must be read before IPM-7 is
accepted. Native UI rendering, real sessions, real-server mutations, push and
real-device behavior remain unverified.

`npm audit` reports two upstream toolchain advisories affecting eight dependency
nodes (three high, five low): Zod collection validation
`GHSA-mrhx-c7xc-m3w5` and deepmerge prototype poisoning
`GHSA-gcqx-w48m-w2h4`. Expo CLI currently depends on Zod 3; the reported fixed Zod
4 version is a major API change. deepmerge's registry latest is still 4.3.1.
No forced dependency override or Expo downgrade was applied. Recheck upstream
fixes before production distribution; do not feed untrusted configuration to
these developer tools.

It’s a Plan MCP is unavailable in this session. Project-center documents and IPM
evidence fields could not be read or updated. No duplicate project/backlog was
created. Link the existing PR and actual CI/artifact results to IPM-4–8 once the
connector is exposed.
