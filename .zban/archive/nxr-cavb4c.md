---
title: Defer macOS test runs in CI
status: done
type: task
priority: high
tags:
  - docs
  - infra
created_at: 2026-11-12T19:24:20Z
closed_at: 2026-11-12T19:25:38Z
---

The user decided on 2026-11-12 to leave macOS out of this repository's CI for the moment, because GitHub's hosted macOS runners are in short supply. The plugin is a JS package with no platform-specific build, so this concerns test runs only. macOS stays a supported host.

- [x] Record the decision and the risk it accepts in Mara
- [x] Adjust `VER-SETUP`, which requires the end-to-end suite on macOS
- [x] Say in the user guidance and in `AGENTS.md` that macOS is not covered by CI yet
- [x] Update the open issues that assume macOS runs, and file a deferred issue for bringing macOS back
- [x] `mara schema validate`, `mara project validate` and `zban check` pass, and the changed pages are formatted

## Summary of Changes

- New decision `ADR-CI-LINUX-ONLY`, which accepts the new risk `RISK-MACOS-UNVERIFIED`. macOS stays a supported host; only the check is deferred.
- `VER-SETUP` now requires the end-to-end suite on Linux and says that it establishes `REQ-COMPATIBILITY` for Linux only until the macOS runs exist.
- Notes that macOS is not covered by CI in `setup.mara.md`, `verification.mara.md`, both READMEs and `AGENTS.md`.
- Issues: `nxr-cxkn34` (CI setup) is Linux only, the 0.1 epic `nxr-w9qa5f` asks for Linux, the napi linking spike `nxr-w7j0wn` keeps its Linux half, and `nxr-wfzc23` (deferred) brings macOS back.

Checks run: `mara schema validate` and `mara project validate` (both `valid: true`, evaluation complete), `zban check` (no findings), `oxfmt --check` on the changed Markdown (clean). No code changed. Nothing is committed.
