---
title: Name the cause where denied warnings fail the test steps under workspace-build
status: done
type: bug
parent: nxr-h52ghk
blocked_by:
  - nxr-k5y74e
related:
  - nxr-tjxcvx
discovered_from: nxr-tjxcvx
created_at: 2026-11-22T11:50:18Z
closed_at: 2026-11-22T15:32:59Z
---

Cites: `DES-TEST-RUN`, `DES-BATCH`, `EVD-CARGO-TARGET-COMMANDS`.

Found while working on nxr-tjxcvx (22 Nov 2026, Cargo 1.100.0). In the `workspace-tests` fixture, with `CARGO_BUILD_WARNINGS=deny` and an unused variable in the library of `d`, a member that neither `a` nor `b` depends on, `nx run-many -t test -p a,b --skip-nx-cache` fails both tasks. The first test step, `cargo test --workspace --no-run`, passes no JSON flag, so cargo itself fails on the warning and stops starting jobs ("build failed, waiting for other jobs to finish"), and `a:test` reports only "cargo test --no-run failed before any test ran, and its output names no crate that did not compile, so it does not show that the tests of a passed." A warning in `a` itself gives the same message.

Failing is safe for the cache (`GOAL-TRUSTED-CACHE`), but the message does not say that denied warnings are the cause.

The maintainer decided on 22 November 2026: "Into rc.2, minimal: keep failing every test task, but make the message name the crate with the warning and the setting that denies it. It would run after nxr-k5y74e, which edits the same files." Per-crate attribution went to the backlog with the JSON compile steps (nxr-hwkc7z).

- [x] Keep failing every test task of a test step that denied warnings stop, and make each task's message name the crates with warnings and the setting that denies them (`CARGO_BUILD_WARNINGS` or the configuration file, as `deniedWarnings` in `nx-rust/src/cargo/warnings-setting.ts` names it)
- [x] Record the decision in `DES-TEST-RUN` and implement it
- [x] Test it with a real cargo on Cargo stable and 1.91 (which ignores `build.warnings`)

Done when: the decided behaviour holds in a test with a real cargo, and `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` and `zban check` pass.


## Summary of Changes

Every test task of a test step that denied warnings stop still fails, and its message now names the packages with warnings and what denies them (`DES-TEST-RUN`, "Denied warnings in a test step"). The reading takes cargo's verdict: where the step failed and its output holds cargo's line ``error: warnings are denied by `build.warnings` configuration``, the packages are those of cargo's summaries that start with `error:` (``error: `d` (lib) generated 1 warning``), each that is no crate of the group is marked as outside the selection of the run with why cargo compiled it, and the setting is named through the same reader as `deniedWarnings` (`denyingSetting` in `nx-rust/src/cargo/warnings-setting.ts`), worded as the JSON compile steps' message. A crate whose build script failed or that did not compile is named as a second cause, and, where cargo names no crate that did not compile, another error adds "cargo reported further errors above". This applies to the steps that `DES-TEST-RUN` names: the build step under `workspace-build`, a `cargo test` or `cargo test --doc` that selects several crates with `-p`, and the build of `cargo nextest run`, whose `json-render-diagnostics` prints the same lines; where the denial first appears in a later step of a whole-workspace run, that step keeps the general message. When warnings are denied, every warning goes into every task's output, whatever crate its location lies in. The denial line, the summaries and the first line of each warning are read without cargo's progress bar before a carriage return (`deniedWarningsLine`), only where the text before it has the bar's shape; every other line is matched as before (`plainLine`, escape sequences only), so that a test's own output after a carriage return is never read as cargo's or nextest's lines. A group of one crate with the `test` option (nxr-k5y74e) is unchanged. `DES-BATCH` points at the new paragraph, `EVD-CARGO-TARGET-COMMANDS` records cargo's output and the review's findings ("build.warnings in the test steps"), and `VER-BATCHING` names the checks.

Checks run, after the second review round: `pnpm nx format:write` and `pnpm nx format:check --all`; `mara schema validate` and `mara project validate` (valid, evaluation complete, no diagnostics); `zban check`; `pnpm nx run-many -t build lint test`; `nx-rust/test/denied-warnings-tests.spec.ts` (new) and `nx-rust/test/denied-warnings.spec.ts` as CI runs them, with Cargo 1.91.0 through a private rustup home and with Cargo 1.100.0 (on 1.91 the tasks pass as plain cargo does), including the forced-progress reproduction through Nx and a reader case that keeps a test's carriage-return line with its test in the nextest reading; `pnpm nx e2e nx-rust-e2e` on Cargo stable. The nextest tests are skipped because cargo-nextest is not installed here; the nextest reading is covered from cargo's lines in the new spec. CI on the pull request covers the 1.91 end-to-end run.

## Decisions made

- The crates come from cargo's own `error:` summaries and the cause from its denial line, never from the plugin's reading of the setting; the setting reader only names what denies warnings, and where nothing that the plugin reads sets `deny`, the message says "Cargo's build.warnings setting, as cargo says". Where cargo names no package, the message says so and points at its diagnostics. Recorded in `DES-TEST-RUN`.
- Cargo starts no new job after the first denied unit, so the message names only the packages cargo compiled until then; it does not claim the list is complete. Recorded in `DES-TEST-RUN` and `EVD-CARGO-TARGET-COMMANDS`.
- A package that is no crate of the group is labelled outside the selection on every path: in a whole-workspace step because the step compiles every member (or, for a non-member, for a crate of the workspace), in a `-p` step because a selected crate needs it. Recorded in `DES-TEST-RUN`.
- The warnings are never presented as the whole cause: a failed build script or a crate that did not compile is named too, and, where cargo names no crate that did not compile, any other error adds "cargo reported further errors above". Recorded in `DES-TEST-RUN`.
- When warnings are denied, every warning goes into every task's output before the routing by location, since each fails the whole step and a file in one crate's folder can belong to another crate. Recorded in `DES-TEST-RUN`.
- Cargo's progress bar before a carriage return is left out only of the lines of denied warnings, and only where the text before the carriage return has the bar's shape; every other line keeps it, since dropping it everywhere (the first review round) let a test's output after a carriage return be read as cargo's or nextest's lines. Forced progress before cargo's compile errors is nxr-9ew9b4 in the backlog. Recorded in `DES-TEST-RUN`.
- Where the denial first appears in a later step of a whole-workspace run (test binaries or doctests), that step keeps the general message for a failed step; no run tried reached it. Recorded in `DES-TEST-RUN`.
