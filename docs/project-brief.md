# Project brief

Date: 2026-10-28 (Europe/Istanbul)

## Goal

Build an Android and iOS companion for self-hosted It's a Plan installations. A single device must support multiple independently hosted servers and separate accounts. Add the server-side integration needed to deliver push notifications to the companion application.

## Product model

The proposed model is an open-source mobile application, open-source server integration, and open-source self-hostable gateway. An optional managed gateway can be a paid service. Pricing and service limits are not defined.

The upstream project uses AGPL-3.0. This companion uses AGPL-3.0-only. Review license compatibility before copying upstream code or importing its packages.

## First release

- Add a server by URL and verify its compatibility.
- Authenticate and store each server/account session separately.
- Switch between servers without mixing caches or credentials.
- List projects and assigned tasks; view details, update status, and write comments.
- Display notifications with their source account and open the correct task.
- Configure notification preferences per account.
- Disconnect an account and revoke its device registration.

Advanced reports, document editing, agent administration, and offline editing are outside the first release.

## Proposed architecture

The mobile client uses React Native, Expo, and TypeScript. It communicates with each server over its API. Native sessions use Keychain/Keystore-backed storage. Account identity must include the server and user; a remote numeric task ID is not globally unique.

The notification flow is: upstream event → authorization and preferences → durable queue → gateway → APNs/FCM → device. The integration should reuse the existing upstream inbox and event mechanisms where possible.

APNs/FCM sending credentials for the official application remain on the gateway. They must not be distributed to arbitrary self-hosted installations. Operators building their own mobile binary can use their own gateway and provider credentials.

The proposed default push payload contains opaque routing identifiers and generic text. The mobile app retrieves content from the originating server using that account's session. This limits lock-screen content; background fetch reliability must be evaluated on real devices.

## Acceptance criteria

- Two independent servers can be signed in on one device.
- Sessions, cached data, and device registrations are isolated by server and account.
- An unavailable server does not block the others.
- Notifications from both servers open the correct account and task.
- Disconnected accounts no longer receive newly generated pushes.
- Temporary delivery errors are retried and invalid device tokens are retired.
- Task and comment content is not sent through the gateway by default.

## Delivery stages

1. Review and select the design language using the standalone HTML prototype.
2. Validate upstream API/authentication and create the Expo application.
3. Implement multi-server accounts and task browsing.
4. Deliver one assignment notification to real Android and iOS devices.
5. Complete comments, status changes, preferences, and the combined inbox.
6. Prepare installation documentation and distribution builds.

## Technical evidence and open questions

Upstream inspected: `croffasia/itsaplan`, commit `73aadf9945ec4c8a23c749fb4f4dee25b036acb3`.

The source includes a REST project API and a project-scoped notification inbox, with assigned, mentioned, commented, and state-changed notification types. The project model includes workspace/team/project references. These existing structures should be reused rather than replaced.

The current PR implements isolated native sessions and API contract checks,
transactional upstream inbox hooks, device registration/revocation, gateway
authentication and PostgreSQL delivery queues. Real upstream HTTPS contract tests
and provider-boundary tests pass. Native session persistence and actual APNs/FCM
delivery require physical-device acceptance. No operator-owned live server or
provider credentials have been supplied; no real push has been sent. See
`services/push/README.md` and `docs/device-testing.md`.
