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
git checkout feat/mobile-foundation
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

No OS push registration, gateway or APNs/FCM sender is connected in this delivery.
An inbox API read is not a push test. Foreground/background/cold-start push,
per-account preferences, device revocation and invalid-token cleanup remain
separate acceptance work. Do not mark push complete from these auth tests.
