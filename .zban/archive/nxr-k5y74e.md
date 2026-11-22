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

After the review of ee613f5: the rule of `DES-TARGETS` (`testReplacesExecutables`) counts every target of kind `test`, also one with `test = false`, because the option can make cargo build and run it, which replaces the executables that `build` stores; such a crate's `test` now waits for its `build` and the test batch puts the build's files back (`untested` in `binary-tests` joined the expectations of `targets.spec.ts`, `batch-runs.spec.ts` and `test-after-build.spec.ts`). The new spec gained real Nx and cargo runs for that case, a mixed `workspace-build` run, a selected run followed by the crate's full run, an unknown name with nextest, and an affected-mode run through Nx with the stand-in for cargo-affected (skipped where nextest is missing); `VER-TESTING` names which checks use the real tools, which need nextest and which run in-process. The affected-mode line and the warning for a missing cargo-affected say what a task with the option runs. After the re-check, a text-only round aligned the remaining wordings: the opt-out and doctest paragraphs of the guidance, `REQ-DOCTESTS` (the exception for the option), `DES-TEST-MODE` and `DES-TEST-RUN` on a crate that opts out, `DES-UNIFICATION` per strategy (under `cargo` the task's command still asks for the workspace's feature unification), and two phrases of `VER-TESTING`. The docs also say that nextest's configuration and `--no-tests=pass` still apply, that `affectedTests = false` beside the option keeps the named target, that a name of digits only has to be set as a string, and, in `DES-UNIFICATION` and `DES-BATCH`, that the batch gives such a task no group to share.

Mara: new evidence `EVD-CARGO-TEST-TARGET-SELECTOR` (cargo 1.100.0 and 1.91.0, cargo-nextest 0.9.152, and the `test = false` case in `binary-tests`); `REQ-TEST-RUNNER`, `REQ-DOCTESTS`, `DES-TEST-RUN` ("One test target"), `DES-TEST-MODE`, `DES-BATCH` ("Groups of one crate", "Files that a test batch puts back"), `DES-UNIFICATION`, `DES-TARGETS` (the rule), `DES-OUTPUTS` ("Who writes the artifact directory"), `DES-PLUGIN-OPTIONS`, `RISK-SUBSET-AS-FULL`, `VER-TARGETS` and `VER-TESTING` changed; user docs in `testing.mara.md` ("One test target"), `configuration.mara.md`, `execution.mara.md` and `targets.mara.md`. `DES-TARGET-COMMANDS` and `DES-INPUTS` needed no change: the other targets' commands and the inputs are unchanged, and the option reaches the key through Nx's hashing of options, which `VER-TESTING` checks.

Checks run after the review (the last, text-only round ran the format, Mara and zban checks again): `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` (valid, evaluation complete, no warnings), `zban check`, `pnpm nx run-many -t build lint test` (85 suites, 2187 passed, with cargo-nextest on PATH), the new `test-target-option.spec.ts` as CI runs it without nextest (13 passed, the nextest checks skipped with a todo), `pnpm nx e2e nx-rust-e2e` (28 passed); the `test = false` check fails without the change to the rule (the executable printed `extra`). CI on the pull request covers the CI check.

## Decisions made

- One option, `test`, a single string passed to cargo as it is (a name or a glob pattern cargo matches); no list and no other selectors (`--lib`, `--bins`, `--example`, test-name filters). A name of digits only is set as a string in a configuration or a target table, because Nx reads it as a number on the command line. Recorded in `DES-PLUGIN-OPTIONS`.
- A task with the option is a group of one crate under every strategy, because cargo fails `--test <name>` only where no selected crate has the target (`-p a -p c --test performance` passed with `c` lacking it). Recorded in `DES-BATCH` and `DES-UNIFICATION`.
- With nextest the doctest step is left out, matching plain `cargo test --test` and since `cargo test --doc` rejects `--test`; the repository's nextest configuration and `--no-tests=pass` still apply to the named target. Recorded in `DES-TEST-RUN`.
- In mode `affected` such a task never selects, runs the named target as in mode `full`, records no subset and says so at the top of its output; beside `affectedTests = false` it still runs the named target, and a missing cargo-affected only gets a warning. Recorded in `DES-TEST-MODE`, `DES-TEST-RUN` and `DES-PLUGIN-OPTIONS`.
- A target of kind `test` with `test = false` counts for the dependency of `test` on `build` and for the files a test batch puts back, because the option, which the graph cannot see on the command line, can make cargo replace the executables for it; some crates' `test` now waits for a `build` it did not need before. Recorded in `DES-TARGETS`.
- `REQ-DOCTESTS` gains one exception, following from the issue's own wording ("skipping `cargo test --doc` when an integration test binary is selected"): a task whose `test` option names a test target runs that target alone, without doctests, with either runner, as `cargo test --test <name>` does, so its result means the same with either runner. Recorded in `REQ-DOCTESTS`.
- Unknown or empty names are left to cargo's error rather than checked against `cargo metadata` by the plugin. Recorded in `DES-TEST-RUN`.
- `--test` goes right after the crate selection in both runners' commands.
