# Upstream API and notifications — IPM-8

Inspected `croffasia/itsaplan` at
`73aadf9945ec4c8a23c749fb4f4dee25b036acb3` on 2026-10-28. This is source-level
research. No live self-hosted server has been supplied or authenticated.

## Native authentication

`packages/auth/src/index.ts` configures better-auth with email/password, username,
passkeys, Google/OIDC, magic links, API keys and MCP OAuth. Web sessions use
cookies; `apps/web/src/lib/api/core/client.ts` sends `credentials: include`.
The inspected configuration contains no Expo or bearer-session plugin.

- Email login: `/api/auth/sign-in/email`; username login:
  `/api/auth/sign-in/username`. Instance settings can disable methods and require
  email verification. Authentication must respect these settings.
- HTTPS session cookies use `__Host-better-auth.*`. Browser cookie handling cannot
  be reused as a single global native cookie jar: two users on the same host must
  have distinct credentials, requests and revocation scopes.
- API keys resolve through `x-api-key` and act as full-account credentials on
  planner routes. They normally expire in 90 days (at most one year). Requests
  carrying this header are deliberately refused on better-auth account endpoints.
  An API-key input is not equivalent to implementing mobile sign-in.
- MCP OAuth access tokens are validated for MCP calls. The planner's
  `shared/mcp-request.ts` carries an MCP token in a request-scoped WeakMap populated
  by tool dispatch. Do not assume the same bearer token authenticates arbitrary
  direct REST calls.

Before connecting a native login screen, validate a supported per-account native
session transport against a real server: cookie issuance, server/user identity,
expiration, method restrictions, CSRF/origin policy, sign-out and redirects.
Evaluate the upstream auth extension hook for the Expo/native session plugin or
a narrowly scoped mobile OAuth integration. Do not silently change the server's
trusted origins or repurpose the MCP audience. A server compatibility handshake
must advertise the supported native transport and API version; no mobile
capability endpoint was found in the inspected source.

## Planner surface

Routes are relative to the configured API base URL, which may include a deployment
path. A web URL must not be assumed to be the API URL.

| Capability | Inspected API |
| --- | --- |
| Projects | `GET /projects`, project `ref` is `<teamRef>.<key>` |
| Project scaffold and states | `GET /projects/:ref` |
| Task detail | `GET /issues/:id` |
| Task by project sequence | `GET /projects/:ref/issues/:seq` |
| Task update | `PATCH /issues/:id`; state uses `columnId` |
| Task search | `GET /issues/search` and project issue search |
| Inbox | `GET /notifications`, optional project/filter/cursor/limit |
| Unread count | `GET /notifications/unread` |
| Mark read | `POST /notifications/:id/read` |
| Existing delivery preferences | `GET/PUT /projects/:ref/notification-preferences` |

Use the API route definitions and OpenAPI schema as wire contracts. The inspected
web inbox helper requires a project argument, but the API route accepts no
project filter and returns the account's combined inbox. Inbox rows include
project/issue references and may refer to documents instead of tasks; handle
unsupported document routes without opening an unrelated task.

## Reuse existing notification infrastructure

`apps/api/src/modules/notifications/service.ts` produces persistent recipient
inbox rows for `assigned`, `mentioned`, `commented` and `state_changed`. It excludes
the actor, filters recipient membership and uses watcher/mention logic. The
outbound enqueue follows that insert and is currently best-effort. A mobile
integration must ensure a failed enqueue cannot silently lose a push event.

`notifications/outbound.ts` applies email/Telegram preferences and enqueues
`notification_delivery`. `apps/worker/src/notification-delivery.ts` claims due
rows using `FOR UPDATE SKIP LOCKED`, leases them, retries transient failures with
jitter and retains permanently failed rows. Reuse this worker model.

The database channel check currently allows only `email` and `telegram`
(`packages/db/src/schema/app.ts`). Mobile delivery needs a migration and typed
channel handling, authenticated per-user/per-installation device registration,
account preferences and logout/revocation endpoints. Existing email/Telegram
payloads include content and are unsuitable as the default push payload.

Proposed push contract: generic title/body and opaque account-registration and
notification routing IDs; no task/comment text or credential. Fetch the actual
content from the selected server under that account's session, rechecking access.
The gateway owns APNs/FCM sending credentials. Each delivery needs a stable
idempotency key, signed authenticated gateway requests, bounded retry, invalid
token cleanup and revocation checks at delivery time. No server, database or
gateway implementation is included in this foundation delivery.

## Required integration evidence

Two independent servers (including same numeric task IDs), two users on one
server, account-scoped expiry/logout, one offline server, foreground/background
and cold-start routing, preference changes, revocation races, duplicate deliveries
and invalid tokens. Real Android and iOS devices are required to accept push.
