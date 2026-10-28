# Physical-device validation — IPM-7, IPM-8, IPM-20

Android and iOS devices are available to the project owner. Device tests have not
been executed by this cloud session. Record actual results against the tested
commit and build in the existing IPM tasks.

## Android

Use the `mobile-android-standalone-preview` artifact from a successful Mobile run.
Unzip it, transfer `app-release.apk` to an arm64 Android device and install it.
This preview embeds the Hermes bundle and needs no Metro connection. CI checks
that `assets/index.android.bundle` exists in the APK. The generated Expo project
signs this internal preview with its development key; this is not Play Store
production signing. Install only the artifact from the project's successful run.

The separate `mobile-android-debug-apk` artifact is for debugging and uses Metro.

## iOS

`mobile-ios-simulator-app` is for macOS Simulator, not a physical iPhone. No Apple
signing credentials are configured in the cloud environment. A signed iPhone
artifact requires the owner's Apple development/provisioning setup.

For a local device build on a Mac with Xcode, clone the PR branch and use:

```sh
git checkout main
npm ci
npm run ios -- --device
```

Choose the connected iPhone and the owner's signing team when Xcode/Expo requests
it. The debug app requires Metro; the Mac and phone need a reachable network path.
Alternatively, the supported Expo Go SDK can load the app from a locally running
`npm start` on the same network. This cloud workspace's localhost is not a phone
preview URL. Provider credentials, passwords and Apple signing secrets must not
be pasted into chat or committed to this repository.

## Auth and account checks

Use HTTPS test instances with password login enabled and test accounts. Enter
the API base URL and, when different, the web origin in the account form. The
temporary integration-test servers live only inside CI and are not accessible
as external phone test servers.

1. Sign in to two independent servers and, separately, two users on one server.
2. Open projects, an assigned task, change a state and post a distinctive test
   comment. Confirm the mutation on the corresponding server's web UI.
3. Open a notification from each source and confirm the correct account/task.
   Verify the combined list's order, unread filter and read/unread controls. On
   the web UI, confirm that the change affected only the originating account.
4. Force-close and reopen the app; confirm each account still resolves to the
   correct `/me` user without entering a password again.
5. Make one server unreachable and verify another account still loads and opens
   tasks. Retry the unavailable server independently.
6. Log out one account. Confirm its server session is gone, its local account is
   removed, and another account's session still works.

Record device model, OS version, commit, artifact/run URL, result of each check
and any redacted error evidence. Native cookie handling and SecureStore behavior
must be exercised here even though the server contract tests pass.

## Push

An inbox API read is not a push test. Real-device foreground/background/cold-start
push remains separate acceptance work. Do not mark push complete from auth tests.

### Current native push integration — IPM-14–19

The app now implements native APNs/FCM token enrolment, account-wide event
preferences, per-device revocation, token refresh and notification-tap routing.
`services/push` supplies the corresponding self-host and gateway extension.
See
[push deployment](../services/push/README.md) for the current implementation.

Real-device validation requires deployed HTTPS servers using the extension,
a configured gateway with APNs/FCM credentials, Firebase client configuration
for Android, and an appropriately signed iPhone app. Expo Go and the unsigned
simulator artifact cannot establish push acceptance.

For each physical platform test foreground, background and force-closed launch:

1. Enable notifications separately for two server accounts. Create a task event
   on each server; verify the OS shows generic text without task/comment content.
2. Tap each notification and verify server, user and task; repeat with equal
   server task IDs. Reject unknown, revoked and cross-account route IDs.
3. Disable one event, then the account master preference. Confirm new excluded
   events do not push and the other account still receives notifications.
4. Re-enable; rotate the native token through the platform's supported test flow
   and verify delivery uses the updated registration without changing preferences.
5. Log out one account; verify its device is revoked and later events do not
   push to it. Keep the second account active throughout.
6. Simulate gateway/provider unavailability and recovery. Inspect bounded retries,
   duplicate handling, permission revocation and invalid-token retirement without
   logging the tokens. Record actual provider receipts and OS results separately.

Record commit/build, device/OS, provider environment, timestamps, task references,
redacted evidence and pass/fail for each mode. These checks are currently unrun.

## Accessibility — IPM-22

Android CI exercises the standalone app at normal, 1.3 and 2.0 system font scales,
including demo/return actions, scrolling to the login control, and opening and
dismissing the software keyboard with a reserved `.invalid` URL. Consult the
actual run report before claiming a check passed. The common header switches to
a vertical arrangement when its font-adjusted available width is narrow.

On each physical Android/iOS device, also check maximum text, VoiceOver/TalkBack
reading order and labels, touch areas, safe areas, URL/email/password keyboard
behavior, password masking and access to the login action while the keyboard is
open. Record device/OS, font setting, commit/build and pass/fail. Avoid screenshots
containing real credentials, accounts or provider tokens. Emulator evidence does
not close physical-device or screen-reader acceptance.
