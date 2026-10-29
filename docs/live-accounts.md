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
credential and attempts to revoke the new, unretained session. Logout revokes
the selected account’s device registration before signing out its server session
and removing its index and credential. If a registration response was lost,
revocation uses the installation UUID instead of relying on a stored device ID.
Failed/offline revocation or logout keeps the account available for retry. Stock
upstream servers return 404 for the optional mobile extension and remain usable.

Project/inbox snapshots and navigation include the account key. Background reads
are independently bounded and canceled on refresh/removal. Available accounts
do not wait for another account's refresh. Late navigation results are discarded.
Request/mutation busy states are account-scoped.
Returning to the foreground refreshes available accounts independently. Expired
sessions clear only that account's loaded views and prompt reauthentication.

## Implemented API views

- Projects for every connected account.
- Tasks assigned to that account, scoped to a selected project (the API's maximum
  500 results is stated in the UI).
- Task detail, available server states, state change and comments.
- Combined inbox sorted by server timestamps, with source account, unread filter,
  cursor pagination and task routing. Read/unread changes are saved to the source
  server. Opening a task marks its notification read only after the task opens.
  Document notifications are identified as unsupported instead of opening an
  unrelated task. Comment feeds have cursor pagination.

The inbox count covers loaded notifications. Each account retains its own cursor;
unloaded pages and unavailable accounts are not counted as read or empty. Overlap
between pages is deduplicated without undoing acknowledged read changes.

Descriptions and comment bodies are displayed as text. Rich document/Markdown
rendering and offline task persistence remain unimplemented. Native push
preferences, registration and routing use the optional server extension described
in [push deployment](../services/push/README.md). Actual APNs/FCM delivery still
requires provider configuration and physical-device acceptance.

## Validation

`npm test` runs 42 domain and transport tests. `npm test --prefix services/push`
runs 6 security/provider tests; install that package with
`npm ci --prefix services/push` before running the expanded integration suite. The actual upstream wire contract
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
single-account logout without invalidating the other sessions. It also generates
real notifications through project invitations and comments on both servers,
verifies correct routing for equal notification/task IDs, read/unread isolation,
rejection of changes to another user's notification, and cursor pagination. A second scenario exercises the real upstream inbox transaction through the
mobile outbox and tenant-isolated gateway, including retries, revocation and
lost-response logout recovery. Only the provider transport boundary is a double. It uses the same client/domain code and
standard Node fetch; Expo's native fetch adapter and SecureStore are verified by
compilation and source inspection, not physical-device execution.

The `Mobile` workflow includes this upstream test. Android and iOS native jobs
depend on both the client validation and real upstream test jobs. Downloaded
debug artifacts require Metro; the Android standalone preview embeds its bundle.
See [physical-device testing](device-testing.md). A green build does not complete real-device auth
or push acceptance. No operator-owned production server was accessed.

The operator API-key connection can access REST and the MCP Streamable HTTP
endpoint. Existing IPM records contain the task/PR/CI evidence. A live isolated
sandbox verified the PlannerClient project/task/state/comment wire contracts
through an API-key transport; it did not exercise native cookie login or OS
credential storage. Provider and physical-device acceptance remain open.
