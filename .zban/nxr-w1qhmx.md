---
title: Attribute denied warnings per crate in the test steps under workspace-build
status: todo
type: bug
related:
  - nxr-tjxcvx
discovered_from: nxr-tjxcvx
created_at: 2026-11-22T11:50:18Z
---

Cites: `DES-TEST-RUN`, `DES-BATCH`, `EVD-CARGO-TARGET-COMMANDS`.

Found while working on nxr-tjxcvx (22 Nov 2026, Cargo 1.100.0). In the `workspace-tests` fixture, with `CARGO_BUILD_WARNINGS=deny` and an unused variable in the library of `d`, a member that neither `a` nor `b` depends on, `nx run-many -t test -p a,b --skip-nx-cache` fails both tasks. The first test step, `cargo test --workspace --no-run`, passes no JSON flag, so cargo itself fails on the warning and stops starting jobs ("build failed, waiting for other jobs to finish"), and `a:test` reports only "cargo test --no-run failed before any test ran, and its output names no crate that did not compile, so it does not show that the tests of a passed." A warning in `a` itself gives the same message.

Failing is safe for the cache (`GOAL-TRUSTED-CACHE`), but it fails tasks for an unrelated crate's warning, unlike `check`, `lint` and `build` after nxr-tjxcvx, and the message does not say that denied warnings are the cause.

- [ ] Decide, with the maintainer where it changes what users see, how the test steps under `workspace-build` treat warnings that `build.warnings` denies: per crate as `DES-BATCH` "Denied warnings" does for the JSON steps, or failing every task with a message that names the crate with the warning and the setting
- [ ] Record the decision in `DES-TEST-RUN` and implement it
- [ ] Test it with a real cargo on Cargo stable and 1.91 (which ignores `build.warnings`)

Done when: the decided behaviour holds in a test with a real cargo, and `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` and `zban check` pass.
