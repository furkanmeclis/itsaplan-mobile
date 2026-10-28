# 0001 — Mobile design language

Status: Accepted — 01 / Sakin

Date: 2026-10-28

## Context

The mobile application must support multiple self-hosted servers and an account-aware notification inbox. The user requested several HTML design options before native implementation.

## Options

1. **Sakin:** light green, rounded cards, calm spacing.
2. **Gece:** dark lavender, denser rows, focused typography.
3. **Atölye:** cream and orange, serif headings, editorial layout.

The standalone prototype compares the same sample information across all three directions. Each includes tasks, projects, an inbox, server switching, a task detail sheet, and a sample server form.

## Decision

The user selected 01 / Sakin. Colors will be configurable through shared theme values. The user also requested the latest stable Expo SDK and the universal `@expo/ui` API from one iOS/Android source. Registry evidence on 2026-10-28: Expo 58.0.20 and @expo/ui 58.0.24.

Tracking: It’s a Plan `technowide-software.IPM`, accepted decision IPM-2; implementation IPM-4 and IPM-5.

Registry recheck on 2026-10-28 before the push delivery advanced the selected
patch versions to Expo 58.0.21 and @expo/ui 58.0.25; `expo install --check` passes.

## Large-text navigation — IPM-22

The shared account/demo header uses an Expo UI column when window width divided
by system font scale is below 250 dp; otherwise it uses a row. This keeps the
navigation action available on narrow screens with large text. The selected
Sakin theme and one universal Android/iOS implementation remain in use.

Android emulator evidence checks 1.3/2.0 font scales, navigation and form
scrolling. Physical-device and screen-reader acceptance is tracked separately.
Review: https://github.com/furkanmeclis/itsaplan-mobile/pull/3

The shared safe-area content is wrapped in KeyboardAvoidingView with padding
behavior. A native Android screenshot exposed the URL field behind the keyboard;
the layout must reserve keyboard space and the emulator check compares field
bounds with the current IME window frame. This uses no platform-specific screen
implementation.
