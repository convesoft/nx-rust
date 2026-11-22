---
title: Hide the warnings that build.warnings = allow hides in shared commands with JSON messages
status: todo
type: bug
priority: deferred
tags:
  - deferred
  - backlog
discovered_from: nxr-tjxcvx
created_at: 2026-11-22T11:50:24Z
---

Cites: `DES-BATCH`, `EVD-CARGO-TARGET-COMMANDS`.

Found while working on nxr-tjxcvx: with `CARGO_BUILD_WARNINGS=allow` (or `build.warnings = "allow"`), plain cargo prints no warnings, while under `--message-format=json` cargo still reports them as `compiler-message`s (recorded in `EVD-CARGO-TARGET-COMMANDS`). A command shared by several crates prints each crate's rendered diagnostics from those messages, so its tasks show warnings that `cargo check -p <crate>` would hide. Only the output differs; no result does.

- [ ] Decide whether shared commands should leave out warnings where `build.warnings` is `allow` (the setting is read by `configuredWarnings` in `nx-rust/src/cargo/warnings-setting.ts`), and record it in `DES-BATCH`
- [ ] Implement and test it if so

Done when: the decision is recorded and, if it changes the output, a test with a real cargo shows it; the local checks of `AGENTS.md` pass.
