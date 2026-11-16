---
title: Select affected tests inside the test target
status: todo
type: feature
parent: nxr-m3k3w8
blocked_by:
  - nxr-539qtw
  - nxr-hvw1rq
  - nxr-3qe5zj
created_at: 2026-11-12T18:20:01Z
---

Goal: with `affectedTests` on, a `test` task runs the selected tests, widened where coverage cannot see a change, and says what it did.

Implements `REQ-AFFECTED-TESTS`, `REQ-SELECTION-SAFETY` and steps 1 and 2 of `DES-TEST-RUN` (`nx-rust/docs/testing.mara.md`). Checked by `VER-TESTING`.

- [ ] The graph-time error for `affectedTests` without nextest, with a case in `nx-rust/test/init.spec.ts` in which `init` fails with it (`VER-SETUP`)
- [ ] Ask cargo-affected for the selection and read its report as step 1 of `DES-TEST-RUN` says: git's `diff.relative` through `GIT_CONFIG_*`, the conditions under which the report is used, and the tests of the group's crates only (`EVD-CARGO-AFFECTED-REPORT`)
- [ ] Compare the baseline's context record with the group's cargo options, triple and environment inputs, and run the full suite with the reason on a difference or a missing record (step 1, `ADR-AFFECTED-BASELINE-CONTEXT`)
- [ ] Take the changed files of the whole repository from git against every usable collection and the working tree, with renames, deletions, untracked files, submodules and ignored declared inputs as step 1 says, and check them against the report's changed files
- [ ] Widen as step 2 of `DES-TEST-RUN` and `ADR-AFFECTED-TESTS-WIDENING` say: narrow only Rust files with rows outside proc macros, build scripts and declared files; give every other changed file to the crates whose `test` inputs hold it, through `^`; full suite for a file the plugin cannot place; integration tests of a binary's crate and all tests of the crates that depend on it
- [ ] Pass the selection to nextest in `-E` arguments as step 3 of `DES-TEST-RUN` says (escaping, 64 KiB per argument, whole binaries above 512 KiB, no nextest run for an empty selection), and map JUnit suites to crates by the binary ID (step 4)
- [ ] Report a fallback to the full suite with its reason, replacing the placeholder note that nxr-539qtw wrote for affected mode
- [ ] Guard the mode between hashing and the run (`DES-TEST-MODE`, known limit; `RISK-SUBSET-AS-FULL`): a task whose key was hashed as `full`, or with other baseline commits than the executor then reads, must never run a subset; test it with a baseline that appears or changes after hashing
- [ ] Check the mode command of nxr-539qtw (`print-test-mode.js`, `EVD-TEST-MODE-READING`) against a database that a real cargo-affected wrote, in a case that is skipped with a warning where the tool is missing
- [ ] Warn when cargo-affected is missing in a run in mode `full`
- [ ] `--affectedTests=false` and the per-crate opt-out (`DES-TEST-RUN`, `DES-PLUGIN-OPTIONS`); the graph-time error for `affectedTests = true` belongs to nxr-xyq7c8
- [ ] The task-time error for `--affectedTests=true` that `DES-DIAGNOSTICS` lists, for a single task and in a batch
- [ ] Count cargo-affected as needed in `init`'s table of tools (`nx-rust/src/tools/optional-tools.ts`) where a workspace has `affectedTests` on, with the fixture for that row that `VER-SETUP` asks for
- [ ] Fixtures for the cases `VER-TESTING` adds: a workspace in a subfolder of its git repository, a proc macro with its own unit tests, a declared file outside the workspace folder, an integration test that starts its crate's binary and a dependent that starts it, a baseline collected without a feature or with another `envInputs` value or without a record, the changed-file cases (older collection, rename, deletion, untracked, submodule, ignored declared input), a repository `default-filter`, and a selection above 128 KiB

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
