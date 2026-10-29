# Native account contract — IPM-8, IPM-9, IPM-20

The native contract job exercises production `PlannerClient`, `ConnectedAccounts`,
Expo fetch and SecureStore against two disposable HTTPS upstream instances. The
backend checkout is pinned to `73aadf9945ec4c8a23c749fb4f4dee25b036acb3` and uses
Bun 1.4.3 and isolated PostgreSQL databases. Four fixture users and their projects
exist only for the test. Their `.test` addresses and password are public fixture
data; operator accounts and credentials are not used.

## Build boundary

The Android job builds and uploads the normal debug/standalone artifacts first.
It then preserves the pilot APK and prepares a separate `.contracttest` package
with `android:testOnly=true`, a different JavaScript entry and a generated test
CA trusted only for `localhost`. Cleartext traffic stays disabled. The CA private
key remains in the fixture controller's temporary directory; only its public
certificate enters the test APK. The production APK must contain neither this
certificate nor the contract entry marker. The built APKs are inspected before
the emulator scenario runs. The test-only APK is not a pilot artifact.

The same shared product application is rendered after the contract bootstrap.
The contract entry is not reachable from the normal application entry.

## Native scenario

1. Sign in to two servers and a second user on one host using actual Expo fetch;
   save three independent credentials through the production SecureStore adapter.
2. Force-stop and restart the process. Restore and verify all three identities.
3. Read equal task IDs from both servers, change one state/comment, merge equal
   notification IDs and acknowledge read state without modifying the other source.
4. Reject a foreign-server cookie, a valid cookie for the wrong same-host user,
   and a credential-bearing redirect before it reaches another server.
   Log out one account and verify its remote session/native secret are removed
   while the other two accounts remain authenticated.
5. Open the real product UI and its source task. Use the real login form for a
   fourth fixture user, checking password masking and typed field state.
6. Pause only the owned first upstream process. Restart the product UI and verify
   that another account's project and task remain usable before the unavailable
   request's deadline. Resume the paused process during cleanup.

`mobile-android-native-account-evidence` holds the scoped JSON result, APK
boundary hashes, screenshots and fresh accessibility hierarchies. Cookies,
passwords and provider tokens are excluded from reports. A capture containing
the fixture password or session-cookie material is suppressed. Test subprocesses
remove operator/provider configuration while preserving proxy and CA settings.

## Local fixture lifecycle

Use a fresh PostgreSQL instance published only on loopback. Install the pinned
upstream dependencies with Bun from its separate test checkout, then run:

```sh
UPSTREAM_ROOT=/path/to/disposable/upstream \
BUN_BINARY=/path/to/bun \
UPSTREAM_DB_URL=postgres://postgres@127.0.0.1:54329/postgres \
NATIVE_FIXTURE_DIR=/tmp/ipm-native \
node integration/run.mjs --serve-native
```

From another terminal, `node integration/wait-native-fixture.mjs /tmp/ipm-native/state.json`
waits for prepared accounts. `node integration/stop-native-fixture.mjs /tmp/ipm-native/state.json`
signals only the validated controller; it closes servers, drops the generated
test databases and deletes the temporary CA/key. Never point this at an operator
database or a production checkout. The Android driver refuses physical devices.

## Evidence limits

Check the actual CI result before treating any native scenario as passed. The
initial local validation covers Node/Bun fixtures, lifecycle cleanup, typecheck
and test-material isolation; it does not establish native transport success.
This first native driver targets Android. iOS simulator compilation, iOS native
Keychain/transport execution, physical-device auth, accessibility and real
APNs/FCM delivery are separate results. No store publication is performed.
