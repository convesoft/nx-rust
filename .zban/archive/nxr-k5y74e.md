---
title: Add a test-target selector option to the test target
status: done
type: feature
parent: nxr-h52ghk
blocked_by:
  - nxr-tjxcvx
discovered_from: nxr-pt464b
created_at: 2026-11-22T10:39:28Z
closed_at: 2026-11-22T13:51:22Z
---

Cites: `DES-TARGETS`, `DES-TARGET-COMMANDS`, `DES-PLUGIN-OPTIONS`, `DES-BATCH`, `DES-TEST-RUN`, `DES-TEST-MODE`, `DES-INPUTS`, `REQ-TEST-RUNNER`, `RISK-SUBSET-AS-FULL`.

In `mara`, running a single integration test binary (for example `cargo test --package mara --test performance --release`) cannot be expressed through the inferred `test` target, forcing a hand-written target.

Note: blocked by `nxr-tjxcvx` to avoid concurrent edits to `nx-rust/src/executors/command.ts` and `group-run.ts`.

- [x] Design and specify the test-target selector option in Mara (`DES-TARGETS`, `DES-TARGET-COMMANDS`, `DES-PLUGIN-OPTIONS`, `DES-BATCH`, `DES-TEST-RUN`, `DES-TEST-MODE`) and user docs (`nx-rust/docs/targets.mara.md`, `testing.mara.md`, `configuration.mara.md`), keeping the option surface minimal and orthogonal
- [x] Implement the option across executor schema (`nx-rust/src/executors/cargo/schema.json`), option validation, `cargo test` (`--test <name>`), and `cargo nextest` (`--test <name>`, skipping `cargo test --doc` when an integration test binary is selected)
- [x] Handle `workspace-build` batching/grouping and `NX_RUST_TEST_MODE=affected` safely so tasks with different selectors never share an incompatible cargo call and a subset result is never stored under a full-suite key (`RISK-SUBSET-AS-FULL`)
- [x] Add unit and real-`cargo` (plus `nextest` where available) tests for single runs, batches, cache-key separation from the full `test` target, and `affected` mode interaction

Done when: a crate can run a single integration test binary through the `test` target (including with `--profile release` and both `cargo` and `nextest` runners), and `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e`, `pnpm nx format:check --all`, `mara schema validate`, `mara project validate`, `zban check` and CI pass.

## Summary of Changes

The `test` target takes a `test` option, cargo's `--test`: `nx test <crate> --test=<name>` runs `cargo test -p <spec> --test <name>`, or with nextest `cargo nextest run --no-tests=pass -p <spec> --test <name>` without the doctest step, with the target's other options such as `--profile=release`. A configuration of `test` in the crate's table (`[package.metadata.nx.targets.test.configurations.performance] test = "performance"`) replaces the hand-written target that `mara` needed. Such a task forms a group of one crate under every strategy, never selects affected tests, and passes on cargo's own exit status.

Mara: new evidence `EVD-CARGO-TEST-TARGET-SELECTOR` (cargo 1.100.0 and 1.91.0, cargo-nextest 0.9.152); `REQ-TEST-RUNNER`, `DES-TEST-RUN` ("One test target"), `DES-TEST-MODE`, `DES-BATCH` ("Groups of one crate"), `DES-PLUGIN-OPTIONS`, `RISK-SUBSET-AS-FULL` and `VER-TESTING` extended; user docs in `testing.mara.md` ("One test target"), `configuration.mara.md`, `execution.mara.md` and `targets.mara.md`. `DES-TARGETS`, `DES-TARGET-COMMANDS` and `DES-INPUTS` needed no change: the target set, the other targets' commands and the inputs are unchanged, and the option reaches the key through Nx's hashing of options, which `VER-TESTING` checks.

Checks run: `pnpm nx run-many -t build lint test` (83 suites, 2172 passed, with cargo-nextest on PATH), the new `test-target-option.spec.ts` again without nextest and as CI runs it (11 passed, nextest checks skipped with a todo), `pnpm nx e2e nx-rust-e2e` (28 passed), `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` (valid, evaluation complete, no warnings), `mara related DES-TEST-RUN` (shows `selectedTestTarget`), `zban check`. CI on the pull request covers the CI check.

## Decisions made

- One option, `test`, a single string passed to cargo as it is (a name or a glob pattern cargo matches); no list and no other selectors (`--lib`, `--bins`, `--example`, test-name filters). Recorded in `DES-PLUGIN-OPTIONS`.
- A task with the option is a group of one crate under every strategy, because cargo fails `--test <name>` only where no selected crate has the target (`-p a -p c --test performance` passed with `c` lacking it). Recorded in `DES-BATCH`.
- With nextest the doctest step is left out, matching plain `cargo test --test` and since `cargo test --doc` rejects `--test`. Recorded in `DES-TEST-RUN`.
- In mode `affected` such a task never selects, runs every test of the named target, records no subset and says so at the top of its output. Recorded in `DES-TEST-MODE` and `DES-TEST-RUN`.
- Unknown or empty names are left to cargo's error rather than checked against `cargo metadata` by the plugin. Recorded in `DES-TEST-RUN`.
- `--test` goes right after the crate selection in both runners' commands.
