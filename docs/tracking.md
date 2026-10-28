# Project tracking

Process source of truth: **It’s a Plan Mobile**, project `technowide-software.IPM`, key **IPM**, under Technowide Software.

Code and PR review: https://github.com/furkanmeclis/itsaplan-mobile

The project includes 5 delivery initiatives, 25 acceptance-driven issues, 7 board states, 7 saved views, 7 area labels, 7 documents, 3 task templates, and PR/build evidence URL fields. Task dependencies are recorded as blocking relations.

## Task map

- IPM-1–7: repository, accepted Sakin design, HTML evidence, Expo universal foundation, configurable theme, CI, native builds.
- IPM-8–14: API/auth research, account isolation, server onboarding, project/tasks, detail/comments, inbox routing, preferences.
- IPM-15–19: events, device registration, durable queue, gateway, real-device push.
- IPM-20–22: two-server end-to-end tests, delivery reliability, accessibility.
- IPM-23–25: documentation, licensing, pilot distribution.

Every PR references its IPM identifier. The task records PR, CI run, artifact, and verification evidence. Completed local prototypes are not equivalent to merged and verified features.

GitHub Projects access was denied by the current integration. The user selected It’s a Plan MCP for process tracking; that permission no longer blocks this workflow. No GitHub Project was created.

## Push implementation evidence

PR #1 was merged into `main` at `b25f8a9c979c2f4a498e898ff97d26719933bc55`
with passing native Android/iOS, client and real-upstream CI. It includes
IPM-14–18 implementation: account event preferences, native
APNs/FCM registration/revocation, an upstream-inbox transaction outbox, worker
integration, tenant-isolated gateway and provider adapters. IPM-19 remains
unverified until real signed Android/iOS devices receive and open notifications.
The extension/deployment contract is in `services/push/README.md`; physical
acceptance steps are in `docs/device-testing.md`. A test provider boundary is
explicitly used in the real-upstream integration suite.

The operator API-key connection reaches the server’s MCP Streamable HTTP endpoint.
Existing IPM task descriptions, states, PR/CI fields and project documents were
updated and read back. Operator test mutations use a separate sandbox team; the
existing IPM project remains the process source. Native cookie authentication and
real-device push remain separate acceptance work.


IPM-22: the Mobile workflow runs the standalone APK on an Android 15 emulator after
native compilation. The smoke check opens real account entry, switches to the
explicitly labeled local demo, returns, and renders account entry at font scale
1.3 and 2.0. Maximum-font navigation, scrolling to the login control and software
keyboard open/dismiss checks extend this evidence. PNGs, accessibility hierarchy XML and a JSON report are retained as
`mobile-android-ui-evidence`. These checks use no server credentials, native login
or APNs/FCM delivery. Physical Android/iOS accessibility acceptance remains open.

IPM-21 follow-up: mobile/gateway queue claims enforce the eight-attempt budget
when recovering from a worker crash. Expired exhausted rows become terminal in
bounded batches; unexpired leases remain unchanged. Real PostgreSQL tests
simulate persisted crash states, exercise concurrent recovery, and verify no
ninth forwarding/provider call. The merged baseline reproduced the bug; the
fixed integration passed. Actual APNs/FCM device delivery remains unverified.

PR #2 merged the retry recovery at `2fa35d225a1abf8baabeafed81c125983aca59bc`.
