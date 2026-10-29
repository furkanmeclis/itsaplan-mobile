# Native push build configuration — IPM-19, IPM-25

The `expo-notifications` config plugin configures the default Android channel
(`default`) and iOS APNs entitlement. Its accent uses the shared Sakin theme.
`app.config.ts` reads only two optional native client build settings:

- `GOOGLE_SERVICES_FILE`: path to the Firebase **Android client**
  `google-services.json`, mounted outside the repository. The application package
  must match `software.technowide.itsaplan.mobile`. Missing files, mismatched
  packages and service-account JSON fail with a generic configuration error.
- `MOBILE_APNS_ENVIRONMENT`: `development` (default) or `production`. Match the
  signing/provisioning profile and gateway `APNS_ENVIRONMENT`. Use production for
  TestFlight/App Store builds. This setting does not create a signing identity.

Copy `.env.example` to an ignored `.env` for local build settings, or configure
the variables/file in the build environment. Re-run Expo prebuild and rebuild
the native binary after changes. Android builds without Firebase client config
remain suitable for UI/auth tests; they are not proof of FCM registration.
The CI simulator build remains unsigned. Neither setting enables store release.

Provider send credentials (`APNS_KEY_FILE`, APNs key/team IDs and
`FCM_SERVICE_ACCOUNT_FILE`) belong only to the push gateway. Never put a `.p8`
key or Firebase service-account file into the mobile config, source tree or
`EXPO_PUBLIC_*`. The client Google configuration becomes part of the Android
binary; it is not a substitute for server authorization or gateway credentials.
API keys for the operator's Its Plan account are not mobile build settings.

Check config without printing any credential files:

```sh
npm run typecheck
npm test
npx expo config --type introspect --json > /tmp/mobile-native-config.json
npx expo prebuild --platform android --no-install
```

Treat the introspection output as build material; do not upload local config
files or unfiltered output containing organization-specific project settings.
An iPhone install still requires an Apple Developer signing identity and device
provisioning. Real push acceptance additionally requires the server mobile
adapter, a deployed gateway and physical-device delivery/tap/logout checks in
[device-testing.md](device-testing.md). No provider/device test is claimed by
this configuration change. Silent background delivery is not enabled.
