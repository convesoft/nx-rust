---
title: Run the test suites on macOS in CI
status: todo
type: task
priority: deferred
tags:
  - infra
discovered_from: nxr-cavb4c
created_at: 2026-11-12T19:25:14Z
---

CI runs on Linux only for the moment, because GitHub's hosted macOS runners are in short supply (`ADR-CI-LINUX-ONLY`, decided by the user on 2026-11-12). macOS stays a supported host (`REQ-COMPATIBILITY`), so `RISK-MACOS-UNVERIFIED` stays open until this is done. The plugin has no platform-specific build; this is about test runs.

- [ ] Confirm with the user that macOS runners are usable again
- [ ] Add macOS jobs for the unit tests and the end-to-end suite to the workflow
- [ ] Run `cargo test` and nextest on a napi crate on macOS, the half of the napi linking spike that was moved here
- [ ] Fix, or file as issues, what the first macOS runs find
- [ ] Restore the macOS part of `VER-SETUP`, retire `ADR-CI-LINUX-ONLY` and `RISK-MACOS-UNVERIFIED`, and remove the notes about CI in `setup.mara.md`, `verification.mara.md`, both READMEs and `AGENTS.md`

Done when: a pull request shows the macOS jobs green, and `mara project validate` reports `valid: true`.
