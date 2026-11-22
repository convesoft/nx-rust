---
title: Name the cause where denied warnings fail the test steps under workspace-build
status: todo
type: bug
parent: nxr-h52ghk
blocked_by:
  - nxr-k5y74e
related:
  - nxr-tjxcvx
discovered_from: nxr-tjxcvx
created_at: 2026-11-22T11:50:18Z
---

Cites: `DES-TEST-RUN`, `DES-BATCH`, `EVD-CARGO-TARGET-COMMANDS`.

Found while working on nxr-tjxcvx (22 Nov 2026, Cargo 1.100.0). In the `workspace-tests` fixture, with `CARGO_BUILD_WARNINGS=deny` and an unused variable in the library of `d`, a member that neither `a` nor `b` depends on, `nx run-many -t test -p a,b --skip-nx-cache` fails both tasks. The first test step, `cargo test --workspace --no-run`, passes no JSON flag, so cargo itself fails on the warning and stops starting jobs ("build failed, waiting for other jobs to finish"), and `a:test` reports only "cargo test --no-run failed before any test ran, and its output names no crate that did not compile, so it does not show that the tests of a passed." A warning in `a` itself gives the same message.

Failing is safe for the cache (`GOAL-TRUSTED-CACHE`), but the message does not say that denied warnings are the cause.

The maintainer decided on 22 November 2026: "Into rc.2, minimal: keep failing every test task, but make the message name the crate with the warning and the setting that denies it. It would run after nxr-k5y74e, which edits the same files." Per-crate attribution went to the backlog with the JSON compile steps (nxr-hwkc7z).

- [ ] Keep failing every test task of a test step that denied warnings stop, and make each task's message name the crates with warnings and the setting that denies them (`CARGO_BUILD_WARNINGS` or the configuration file, as `deniedWarnings` in `nx-rust/src/cargo/warnings-setting.ts` names it)
- [ ] Record the decision in `DES-TEST-RUN` and implement it
- [ ] Test it with a real cargo on Cargo stable and 1.91 (which ignores `build.warnings`)

Done when: the decided behaviour holds in a test with a real cargo, and `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` and `zban check` pass.
