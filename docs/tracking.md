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

## Push implementation evidence (merged in PR #1)

Merged PR #1 includes IPM-14–18 implementation: account event preferences, native
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
