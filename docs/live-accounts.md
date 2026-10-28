# Live accounts — IPM-8, IPM-9, IPM-10, IPM-11, IPM-12, IPM-13

The default app opens real server accounts. The demo is available through the
separate **Demoyu incele** control and retains its visible sample-data notice.
No account or task from the demo is inserted into the real account list.

## Connect

Enter the HTTPS **API base URL**, email or username, and password. If the web
sign-in site has a different origin, enter that site too. The client sends that
origin to better-auth; it does not change the server's trusted origins. A deployment
path on the API URL is preserved. HTTP, URL credentials, fragments and query
strings are rejected. Only connect to servers you trust with your password.

Discovery verifies the API health identity and `/auth-config`. Only enabled
email/password and username/password login are implemented. SSO, magic links,
passkeys, MFA and custom auth cookie names need additional integration. There is
no invented mobile-version handshake; contract validation detects unsupported
response shapes and reports an error.

After sign-in, `/me` must confirm the returned user ID. The client retains only
the Secure/HttpOnly better-auth session-token cookie, not the password or session
cache cookies. All requests use `expo/fetch` with `credentials: omit`, an explicit
account cookie, `redirect: error`, per-request deadlines and no-store/no-cache
headers. The installed Android implementation selects `CookieJar.NO_COOKIES`
when credentials are omitted; iOS disables `httpShouldHandleCookies` on that
request. OS cookie/cache behavior still needs tests on physical devices.

## Account storage and isolation

Session cookies are stored in Keychain/Keystore through SecureStore, under a
SHA-256 slot of `[canonical API base URL, user ID]`. The non-secret account list
(URL, user ID, display name, web origin) uses AsyncStorage. Passwords are cleared
from the input after submission and never persisted. The server is the authority
for expiration and revocation; an expired account prompts reauthentication.

Account-index mutations are serialized. Failed index persistence rolls back the
credential and attempts to revoke the new, unretained session. Logout signs out
the selected server session before removing its index and credential. An offline
logout leaves the account available for retry. No device registration exists yet,
so this is session logout, not push-device revocation.

Project/inbox snapshots and navigation include the account key. Background reads
are independently bounded and canceled on refresh/removal. Available accounts
do not wait for another account's refresh. Late navigation results are discarded.
Request/mutation busy states are account-scoped.

## Implemented API views

- Projects for every connected account.
- Tasks assigned to that account, scoped to a selected project (the API's maximum
  500 results is stated in the UI).
- Task detail, available server states, state change and comments.
- Account-grouped inbox with source account, cursor pagination and task routing.
  Document notifications are identified as unsupported instead of opening an
  unrelated task. Comment feeds have cursor pagination.

Descriptions and comment bodies are displayed as text. Rich document/Markdown
rendering, a globally sorted inbox, marking read, offline data persistence, push
preferences and APNs/FCM delivery are not part of this change.

## Validation

`npm test` runs 26 domain and transport tests. The actual upstream wire contract
has a separate test against two independently migrated PostgreSQL databases and
two real Elysia/better-auth HTTPS servers, pinned to upstream commit
`73aadf9945ec4c8a23c749fb4f4dee25b036acb3` and Bun 1.4.3.

To repeat against an installed upstream checkout and a disposable local PostgreSQL:

```sh
UPSTREAM_ROOT=/path/to/itsaplan BUN_BINARY=/path/to/bun \
  UPSTREAM_DB_URL=postgres://postgres@127.0.0.1:5432/postgres \
  node integration/run.mjs
```

The PostgreSQL user must be able to create databases. The runner creates random
database names, temporary TLS certificates and disposable server secrets. It
verifies the certificate through a temporary test CA without disabling TLS,
then stops its own servers and removes only its own databases/files. Migration
backups are skipped only for those disposable databases. Existing upstream source
and lockfiles remain unchanged. Do not point this runner at a production database.

The scenario checks login, two users on one host, equal task IDs on independent
servers, assigned-task summaries, task details, state updates, comments, inbox and
single-account logout without invalidating the other sessions. It is one
end-to-end test with multiple assertions. It uses the same client/domain code and
standard Node fetch; Expo's native fetch adapter and SecureStore are verified by
compilation and source inspection, not physical-device execution.

The `Mobile` workflow includes this upstream test. Android and iOS native jobs
depend on both the client validation and real upstream test jobs. Downloaded
debug artifacts require Metro. A green build does not complete real-device auth
or push acceptance. No operator-owned production server was accessed.

It’s a Plan MCP remains unavailable in this session. These files document code
and evidence; they do not replace the existing IPM project or its acceptance
records. Task fields must be updated through that connector when it is exposed.
