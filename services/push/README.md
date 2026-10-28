# Self-host push extension — IPM-14–19, IPM-21

AGPL-3.0-only. This extension targets upstream `croffasia/itsaplan` commit
`73aadf9945ec4c8a23c749fb4f4dee25b036acb3`. It is implemented in this repository;
stock upstream installations do not expose `/mobile/*`.

## Data flow and boundaries

An `AFTER INSERT` trigger on upstream `notification` creates `mobile_delivery`
rows in the same transaction. Only task events for active recipients with a
project membership, enabled preferences and an active device are queued. The
mobile worker uses upstream's poll-loop and permission helpers and reads the
upstream database directly; it does not import or call `apps/api`. Immediately
before forwarding it rechecks user activity, membership and work-item read
permission. Existing upstream inbox/email workers keep their own behavior.

The gateway authenticates each self-host installation with a separate hashed
256-bit tenant key. It stores provider tokens encrypted with AES-256-GCM, bound
to tenant and device through authenticated associated data. Server-side copies
use a separate encryption key and device binding. Provider signing credentials
exist only on the gateway worker, never on self-host servers or mobile clients.
Use separate databases, database users and encryption keys for server and gateway.

Gateway route UUIDs are globally unique, distinct from server task/user IDs.
The visible message is always `It’s a Plan` / `Yeni bir bildirimin var.`. The only
custom payload fields are `v`, `accountId` and `notificationId` (opaque UUIDs).
The mobile app resolves the route through the locally stored account mapping
and the originating authenticated server. That server rechecks ownership and
permission before returning a task ID. Task/comment text never enters push
payloads or gateway delivery rows. Notification traffic still exposes timing,
token and opaque identifiers to the gateway/provider; this is not anonymity.

Both queues use database leases, `SKIP LOCKED`, stable delivery IDs and bounded
exponential retries with jitter (8 attempts). Gateway receipt is idempotent per
tenant and delivery ID; conflicting reuse is rejected. Provider `Retry-After`
is honored up to one day. Revocation, preference changes and provider-invalid
tokens cancel pending work; invalid/revoked tokens are wiped. In-flight provider
requests may finish before revocation returns. A process crash after provider
acceptance can cause a repeated visible notification: APNs/FCM do not promise
exactly-once delivery. Routing/read operations tolerate repeated responses.

Preferences are account-wide and disabled by default. A device registration is
per user and installation UUID. Logging out revokes only that device before
revoking its upstream session; failed revocation keeps local state for retry.
Expired sessions require signing in again before revocation can be completed.

## Installation

Prerequisites: Node 24, Bun 1.4.3, PostgreSQL 17, an upstream installation at the
pinned commit with its dependencies installed, HTTPS endpoints with valid trust,
and secure configuration/secrets supplied by your deployment system.

```sh
npm ci --prefix services/push
npm run typecheck --prefix services/push
npm test --prefix services/push
```

Run upstream's documented database migrations **first**, taking its normal
backup. The wrappers apply the extension migrations transactionally once, under
an advisory lock, and verify their checksum on restart. Never edit an already
applied migration; future schema changes need a new migration version. Back up
the databases and their corresponding encryption keys together. There is no
automatic key rotation or schema downgrade in this initial extension.

Start the API wrapper instead of upstream's API entrypoint:

```sh
bun services/push/src/api-main.mjs
```

It mounts `/mobile/*` and delegates every other request to the existing upstream
app, including authentication. Existing upstream background initialization is
retained. Set `UPSTREAM_ROOT` to the absolute upstream checkout directory;
configure upstream's normal environment (`DATABASE_URL`, `API_URL`, `APP_URL`,
auth and encryption configuration), plus `MOBILE_ENCRYPTION_KEY`,
`MOBILE_GATEWAY_URL` and `MOBILE_GATEWAY_KEY`. Origin checks use upstream's web
origins. A partially configured gateway is not a working push deployment.

Start the worker wrapper instead of upstream's worker entrypoint:

```sh
bun services/push/src/worker-main.mjs
```

It starts the existing workers and one mobile poll loop. Supply upstream's
normal worker environment plus `DATABASE_URL`, `UPSTREAM_ROOT`,
`MOBILE_GATEWAY_URL`, `MOBILE_GATEWAY_KEY`. Its permission adapter matches the
pinned upstream project/team/workspace roles; custom upstream permission
extensions require reviewing the adapter before deployment.

On a separate gateway host, set `GATEWAY_DATABASE_URL` and a separate
`GATEWAY_ENCRYPTION_KEY` (32 random bytes encoded as base64), then run:

```sh
npm run gateway --prefix services/push
npm run gateway:worker --prefix services/push
```

These are separate long-lived processes. The HTTP gateway listens on `PORT`
(default 8080), behind your HTTPS reverse proxy. Expose it only through that
proxy; keep PostgreSQL private. Forward `/v1/*` without path rewriting. Disable
request-body/authorization logging and bound body size (16 KB) and request time
at the proxy. The gateway limits each tenant to 300 requests/minute and 10,000
devices; the server limits users to 16 installations. Rate buckets older than
two days are cleaned hourly by the worker. Keep terminal delivery IDs for
idempotency; retention/archival requires an explicit matching retry/dedup policy.
No automatic retention expiry deletes an active device token.

Provision a separate tenant credential for each self-host server:

```sh
cd services/push
node --import tsx src/provision-tenant.ts /secure/new-tenant.json
```

The destination must not exist; it is written mode 0600.
Only the tenant ID is printed. Transfer its `key` through secure configuration
as the server's `MOBILE_GATEWAY_KEY`, then protect/remove the transfer file.
Disable a compromised tenant using `push_tenant.active=false`; pending sends
recheck this state. Back up before operational database changes.

### Provider configuration (gateway worker only)

For APNs mount the private `.p8` key at `APNS_KEY_FILE`; set `APNS_KEY_ID`,
`APNS_TEAM_ID`, `APNS_TOPIC` (the app bundle identifier), and
`APNS_ENVIRONMENT=development` for development-signed devices or `production`
for distribution. The provider uses HTTP/2, ES256 tokens and the corresponding
fixed Apple endpoint. `HTTPS_PROXY` CONNECT is supported with TLS verification.

For Node 24 behind an outbound proxy, set `NODE_USE_ENV_PROXY=1` and preserve
your `HTTPS_PROXY`, `NO_PROXY` and trusted CA configuration. Keep internal
PostgreSQL/loopback traffic in the appropriate bypass list; never disable TLS
verification. The APNs transport handles HTTPS proxy CONNECT itself.

For FCM mount a service-account JSON at `FCM_SERVICE_ACCOUNT_FILE`. The adapter
uses its `client_email`, RSA `private_key`, and `project_id` with the fixed Google
OAuth and FCM HTTP v1 endpoints. Ignore arbitrary token URLs in account files.
At least one provider must be configured or the worker refuses to start.
Unconfigured platforms retry to the bounded failure limit; configure both
providers before offering both platforms. Monitor failed queues using counts
and sanitized `last_error` codes, never token/payload/credential logging.

The Android build separately needs the matching Firebase **client** configuration
via `GOOGLE_SERVICES_FILE` during Expo prebuild. This is different from the
server service-account signing key. APNs needs a correctly signed application
with the push entitlement. Provider identity, package/bundle IDs and the built
application must agree. Expo Go does not validate this native push integration.

## API contract

- `GET /mobile/capabilities`: protocol 1, gateway availability, supported events.
- `GET /mobile/preferences`: current account preferences, default disabled.
- `PUT /mobile/preferences`: `{enabled,events}`; synchronizes all its devices.
- `POST /mobile/devices`: `{installationId,provider,token}`; authenticated user
  determines ownership; returns `{deviceId,accountId}`. Retrying registration
  retains IDs; re-registration is required after provider token retirement.
- `DELETE /mobile/devices/:deviceId`: revoke only that user's installation.
- `DELETE /mobile/installations/:installationId`: owner-scoped idempotent revoke
  when a registration response was lost before the client stored its device ID.
- `GET /mobile/notifications/:opaqueId`: owner/permission-checked task route.

All authenticated routes reuse upstream session cookies. Unknown fields and
invalid IDs/tokens are rejected. Credentials, provider tokens and raw provider
errors are never returned in errors. Preference synchronization can return 503
with the desired local preference retained; retry the same operation. Revoke
can return 503 after locally disabling the device until gateway acknowledgement
succeeds. This does not silently report a completed logout.

## Verification and current limits

`node integration/run.mjs` (see root integration documentation/environment)
starts two disposable real upstream HTTPS APIs and a gateway with three
independent PostgreSQL databases. It exercises real signup/login/inbox events,
queue transactions, authorization, concurrent claims, token encryption,
idempotency, retry deadlines, preference cancellation and revocation. **Only the
provider boundary is a test double.** Unit tests validate real JWT signatures,
fixed provider destinations, generic payloads and response handling using
injected transports. No APNs/FCM credentials or physical devices are used in CI.

Actual signed Android/iOS device deliveries, foreground/background/cold-start
taps, offline recovery and token rotation remain required acceptance evidence.
See ../../docs/device-testing.md. This extension is not marked production-ready
or real-device verified from a passing simulator build or mocked provider test.
