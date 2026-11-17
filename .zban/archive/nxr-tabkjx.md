---
title: Select affected tests inside the test target
status: done
type: feature
parent: nxr-m3k3w8
blocked_by:
  - nxr-539qtw
  - nxr-hvw1rq
  - nxr-3qe5zj
created_at: 2026-11-12T18:20:01Z
closed_at: 2026-11-17T09:37:38Z
---

Goal: with `affectedTests` on, a `test` task runs the selected tests, widened where coverage cannot see a change, and says what it did.

Implements `REQ-AFFECTED-TESTS`, `REQ-SELECTION-SAFETY` and steps 1 and 2 of `DES-TEST-RUN` (`nx-rust/docs/testing.mara.md`). Checked by `VER-TESTING`.

- [x] The graph-time error for `affectedTests` without nextest, with a case in `nx-rust/test/init.spec.ts` in which `init` fails with it (`VER-SETUP`)
- [x] Ask cargo-affected for the selection and read its report as step 1 of `DES-TEST-RUN` says: git's `diff.relative` through `GIT_CONFIG_*`, the conditions under which the report is used, and the tests of the group's crates only (`EVD-CARGO-AFFECTED-REPORT`)
- [x] Compare the baseline's context record with the group's cargo options, triple and environment inputs, and run the full suite with the reason on a difference or a missing record (step 1, `ADR-AFFECTED-BASELINE-CONTEXT`)
- [x] Take the changed files of the whole repository from git against every usable collection and the working tree, with renames, deletions, untracked files, submodules and ignored declared inputs as step 1 says, and check them against the report's changed files
- [x] Widen as step 2 of `DES-TEST-RUN` and `ADR-AFFECTED-TESTS-WIDENING` say: narrow only Rust files with rows outside proc macros, build scripts and declared files; give every other changed file to the crates whose `test` inputs hold it, through `^`; full suite for a file the plugin cannot place; integration tests of a binary's crate and all tests of the crates that depend on it
- [x] Pass the selection to nextest in `-E` arguments as step 3 of `DES-TEST-RUN` says (escaping, 64 KiB per argument, whole binaries above 512 KiB, no nextest run for an empty selection), and map JUnit suites to crates by the binary ID (step 4)
- [x] Report a fallback to the full suite with its reason, replacing the placeholder note that nxr-539qtw wrote for affected mode
- [x] Guard the mode between hashing and the run (`DES-TEST-MODE`, known limit; `RISK-SUBSET-AS-FULL`): a task whose key was hashed as `full`, or with other baseline commits than the executor then reads, must never run a subset; test it with a baseline that appears or changes after hashing
- [x] Check the mode command of nxr-539qtw (`print-test-mode.js`, `EVD-TEST-MODE-READING`) against a database that a real cargo-affected wrote, in a case that is skipped with a warning where the tool is missing
- [x] Warn when cargo-affected is missing in a run in mode `full`
- [x] `--affectedTests=false` and the per-crate opt-out (`DES-TEST-RUN`, `DES-PLUGIN-OPTIONS`); the graph-time error for `affectedTests = true` belongs to nxr-xyq7c8
- [x] The task-time error for `--affectedTests=true` that `DES-DIAGNOSTICS` lists, for a single task and in a batch
- [x] Count cargo-affected as needed in `init`'s table of tools (`nx-rust/src/tools/optional-tools.ts`) where a workspace has `affectedTests` on, with the fixture for that row that `VER-SETUP` asks for
- [x] Fixtures for the cases `VER-TESTING` adds: a workspace in a subfolder of its git repository, a proc macro with its own unit tests, a declared file outside the workspace folder, an integration test that starts its crate's binary and a dependent that starts it, a baseline collected without a feature or with another `envInputs` value or without a record, the changed-file cases (older collection, rename, deletion, untracked, submodule, ignored declared input), a repository `default-filter`, and a selection above 128 KiB

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Summary of Changes

With `affectedTests` and the nextest runner, a `test` group in mode `affected` now runs steps 1 to 3 of `DES-TEST-RUN`:
- It checks the guard of `DES-TEST-MODE` ("Between hashing and the run").
- It compares the baseline's context record (`ADR-AFFECTED-BASELINE-CONTEXT`).
- It runs one `cargo affected status` with git's `diff.relative`, reads the report only on exit 0, schema 1 and a hit, and checks the changed files against git's own list across every usable collection.
- It widens the selection by the tasks' inputs (`ADR-AFFECTED-TESTS-WIDENING`) and passes the selection to nextest in `-E` arguments. The nextest run is left out where nothing is selected.
- Each task says what it ran and why, or why the full suite ran.

Further changes:
- Graph creation fails for `affectedTests` without nextest.
- `init` counts cargo-affected as needed where a workspace turns on `affectedTests`.
- `--affectedTests=true` fails the task before cargo runs, alone and in a batch.
- A missing cargo-affected warns in mode `full` and fails the task in mode `affected`.

The guard: the mode command records what it prints for each `nx` command, and the executor selects only where every affected-mode evaluation of the command printed the mode that the executor reads. A subset run is marked, so that a later evaluation in the same command, as Nx 24 does after a batch task's run, prints a value that is never restored.

Mara: `DES-TEST-MODE`, `DES-TEST-RUN` ("How steps 1 to 3 are carried out"), `DES-BASELINE`, `RISK-SUBSET-AS-FULL`, `EVD-TEST-MODE-READING`, the new `EVD-TEST-MODE-GUARD` and `EVD-AFFECTED-RUNS`, and the testing guide. The real-database check of the mode command is in `affected-coverage.spec.ts`.

New tests: `affected-selection.spec.ts`, `affected-runs.spec.ts` (with a stand-in for cargo-affected) and `affected-coverage.spec.ts` (real cargo-affected 0.4.1 and llvm-tools). New fixture: `affected-tests`. Added cases in `init.spec.ts`, `configuration.spec.ts` and `test-mode.spec.ts`. The tests take llvm-cov only from `NX_RUST_TEST_LLVM_TOOLS` or the toolchain's `llvm-tools`, of the toolchain's LLVM version, and skip with the reason otherwise.

Checks run:
- On merged head 76c0c70: `NX_DAEMON=false pnpm nx run-many -t build lint test --skip-nx-cache` with the real tools: 67 suites, 2001 passed, 7 skipped and 1 todo. Those are wasm-build cases from main that need `wasm-bindgen`.
- On 76c0c70: `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` (valid, evaluation complete) and `zban check`.
- The changed specs on Cargo 1.91.0 through a private `RUSTUP_HOME`: 8 suites, 326 passed, 8 skipped. The skipped cases are the real-coverage ones, since 1.91.0 has no `llvm-tools` and its LLVM is 21.
- Before the merge, on 8d1f9b9: the test target without the tools (66 suites, 1948 passed, 34 skipped, 5 todo) and `pnpm nx e2e nx-rust-e2e --skip-nx-cache` on Cargo 1.100.0 (27 passed). The merge brought only the wasm target, which does not change the test target.

Rejected: a guard by the times of the database files, which every `status` defeats because it writes the database, and recomputing the key in the executor.

Follow-ups: nxr-4byqv8 (keep selection for a task hashed while another task's status runs) and nxr-rsdjab (restrict the ignored-input check to declared files).


## Summary of the review fixes

The one review of 3a2a9b4 found four defects. All are fixed:

1. **A subset could be restored for a full-mode task.** The guard now sets no evaluation aside. A task selects only where every evaluation that its `nx` command recorded for its workspace printed exactly the mode that its executor reads; otherwise it runs the full suite and says that the command's tasks were hashed in different test modes. Nx runs runtime inputs with `getTaskSpecificEnv`, which names no task, so the rule cannot be narrowed to a task's own evaluations (`EVD-TEST-MODE-GUARD`).
2. **Runtime inputs did not constrain the selection.** The context record, now version 2, holds the SHA-256 of the output of every runtime input of the `test` tasks except the test mode command. The executor runs them again through `sh -c` in the repository root with the task's environment. A difference, a failing command or a record of version 1 runs the full suite and names the input (`ADR-AFFECTED-BASELINE-CONTEXT`, `DES-BASELINE`, `DES-TEST-RUN` step 1).
3. **A renamed test target broke affected runs.** The selection inspects and reads the test target under the name that `targetNames` gives it. An inspection error gives the full suite instead of failing the task.
4. **A stale record could fail an unrelated command.** `postTasksExecution` removes records on a best-effort basis and never fails a command. An unwritable record makes affected-mode tasks run their full suite with the reason.

Tests:
- `affected-selection.spec.ts` (25): the review's sequence for finding 1, and runtime-input differences, equality, a failing command and a record of version 1.
- `affected-runs.spec.ts` (13): through Nx, a command whose tasks are hashed in different modes, after which a later full-mode command restores only the full result; a changed and an unchanged runtime input; a target renamed to `unit-test`, with and without a baseline; an unwritable record in a workspace with `affectedTests`, and a stale record in one without. Run against the old hook, the stale-record case fails with status 1.
- `affected-coverage.spec.ts` (9): the review's real-tool runtime-input case, in which affected mode now runs the full suite, which fails, as full mode does.
- The tests take `llvm-cov` only from `NX_RUST_TEST_LLVM_TOOLS` or the toolchain's `llvm-tools` component, of the toolchain's LLVM major version (the maintainer's decision).

Checks on the final head 76dc3dc:
- `NX_DAEMON=false pnpm nx run-many -t build lint test --skip-nx-cache` with the real tools: 67 suites, 2009 passed. The 7 skipped and 1 todo are wasm-build cases that need `wasm-bindgen`.
- `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` (valid, evaluation complete) and `zban check` passed.
- The eight changed spec files on Cargo 1.91.0 through a private `RUSTUP_HOME`: 333 passed, 9 skipped. The skipped cases are the real-coverage ones, since 1.91.0 has no `llvm-tools` and uses LLVM 21.
- `main` did not move after the merge of b4fc229. As agreed, the control plane runs the end-to-end suite and the unit suite without tools.
