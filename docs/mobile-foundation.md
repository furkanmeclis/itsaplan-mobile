# Mobile foundation — IPM-4, IPM-5, IPM-6, IPM-7

The demo and foundation checks below remain available. The default app now uses
[live account screens](live-accounts.md); that guide describes real API behavior,
the 42 current mobile unit tests and the additional two-server upstream integration job.

The application uses Expo 58.0.21, React Native 0.88.0, React 19.3.0,
TypeScript 6 and the root universal API of `@expo/ui` 58.0.25. One component
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

Every demo screen displays the demo notice. The demo makes no network calls or real
credentials. Tasks, projects, task details, completion/reopening, comments, a
combined source-aware inbox and account-level demo preferences are interactive.
Removing an example account removes its in-memory data. Restarting the app resets
the demo. Preferences do not register or deliver push notifications.

Both example servers deliberately have the same remote user, task and notification
IDs. Identity includes the canonical HTTPS API base URL and user ID. Resource
keys include that account identity and resource kind. Deployment paths are
preserved; URL user info, queries and fragments are rejected.

The storage adapter in `src/storage/secureSessionVault.ts` uses Expo SecureStore
and SHA-256-derived account slots for the live password-login flow. The demo
does not create a session. Unit tests exercise the vault contract with
an in-memory storage port. Keychain/Keystore persistence still needs device tests.
The disconnect contract requires successful device revocation before removing
the credential; offline revocation leaves it available for an explicit retry.
Native registration/revocation and account preferences now use the optional
`services/push` extension. Actual APNs/FCM and physical-device delivery remain unverified.

`loadAccounts` runs requests independently with per-account deadlines and abort
signals. The helper and opaque notification-routing resolver are tested domain
foundations. Real API loading and OS notification response callbacks are now
connected; physical-device execution remains separate acceptance work.

## CI and artifacts

The `Mobile` workflow performs a clean `npm ci`, compatibility check, typecheck,
42 mobile tests, 6 gateway/security/provider tests, and separate Android/iOS
Hermes bundle exports. Native jobs depend on validation and the real upstream
HTTPS integration job:

- `mobile-platform-bundles`: generated Android/iOS JavaScript and metadata.
- `mobile-android-debug-apk`: Gradle debug APK for arm64 devices and x86_64 emulators.
  This development APK requires Metro (`npm start` and `adb reverse tcp:8081 tcp:8081`
  for a USB-connected Android device). It is not a standalone release binary.
- `mobile-android-standalone-preview`: development-key signed arm64/x86_64 APK with
  embedded JavaScript for device testing without Metro; not store distribution.
- `mobile-ios-simulator-app`: unsigned simulator `.app` inside a ZIP; install with
  `xcrun simctl install booted <application.app>`. Debug builds require Metro.

Artifacts expire after 14 days. The iOS job uses macOS 26/Xcode; Android uses
JDK 21 with the JDK 17 compilation toolchain, API 37.0, build tools 37 and NDK 27.1.12297006, matching React Native's installed toolchain
metadata. Generated `android/` and `ios/` projects are ignored and recreated by
Expo prebuild. The HTML design artifact workflow remains separate.

## Evidence and limits

Registry `latest` tags and the official Expo SDK 58 documentation source were
checked on 2026-10-28. References:

- [Expo UI universal documentation](https://docs.expo.dev/versions/v58.0.0/sdk/ui/universal/)
- [Official documentation source](https://github.com/expo/expo/blob/sdk-58/docs/pages/versions/v58.0.0/sdk/ui/universal/index.mdx)
- [Expo template](https://www.npmjs.com/package/expo-template-blank-typescript/v/58.0.29)

Local clean installation, both typechecks, 42 mobile tests, 6 service tests,
both platform bundle exports and the real upstream integration scenarios passed. A generated native project is not a compiled
APK or simulator application. Native CI results must be read before IPM-7 is
accepted. Real upstream session/mutation contracts are verified by the HTTPS
integration suite. Android native entry/demo rendering and 1.3 font scaling passed the emulator
check in CI 40768519614. OS session behavior and actual provider-side/device push
delivery remain unverified.

`npm audit` reports two upstream toolchain advisories affecting eight dependency
nodes (three high, five low): Zod collection validation
`GHSA-mrhx-c7xc-m3w5` and deepmerge prototype poisoning
`GHSA-gcqx-w48m-w2h4`. Expo CLI currently depends on Zod 3; the reported fixed Zod
4 version is a major API change. deepmerge's registry latest is still 4.3.1.
No forced dependency override or Expo downgrade was applied. Recheck upstream
fixes before production distribution; do not feed untrusted configuration to
these developer tools.

The operator API-key connection reaches the real MCP endpoint; project documents
and existing IPM task/evidence fields have been updated. An isolated test team
holds operator fixtures. It does not replace the IPM process project.


## Android UI evidence

After native builds, `android-ui` installs the matching standalone APK on an Android
15/API 35 x86_64 emulator. Its JavaScript is embedded from the same checkout;
no development server is used. It
checks account entry, labeled demo navigation, return navigation and rendering
at system font scales 1.3 and 2.0. At 2.0 it also exercises demo/return navigation
and scrolls the form to its login control without pressing it. A separate check
types only `https://mobile.invalid`, verifies the software keyboard is shown,
and dismisses it with Back while preserving the field. No login is submitted.
Each hierarchy dump removes the previous file first;
font-scale evidence must expose larger text width and height, and regression tests prevent
stale UI labels from being accepted after a failed dump. `mobile-android-ui-evidence` contains PNG screenshots,
UI hierarchy XML, a report and fresh-emulator app logs. No live account is enrolled
and no operator/provider credentials are passed to the job. A passing result is
emulator UI evidence; it is not physical-device, VoiceOver/TalkBack, mobile auth
or provider-delivery acceptance.

Android 14+ uses [nonlinear font scaling](https://developer.android.com/about/versions/14/features#non-linear-font-scaling):
a heading can grow less than 10% in height at font scale 1.3. The check requires
actual growth in both dimensions and the requested system setting, rather than
a fixed percentage. At scale 2.0 text may wrap, so heading height must exceed
the 1.3 height and visible bounds/navigation are verified instead of requiring
unwrapped width growth. The common Expo UI header stacks vertically when
font-adjusted window width is below 250 dp. Physical-device and screen-reader
acceptance remain separate work.
