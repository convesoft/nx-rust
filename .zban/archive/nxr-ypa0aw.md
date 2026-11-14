---
title: Decide how the workspace-build strategy filters which tests run
status: done
type: task
tags:
  - spec
parent: nxr-9y4eh8
related:
  - nxr-8f9dz2
discovered_from: nxr-gqad20
created_at: 2026-11-14T15:08:21Z
closed_at: 2026-11-14T18:28:05Z
---

Goal: `DES-UNIFICATION` says how the `workspace-build` strategy filters which tests run, so that a batched `test` run under it keeps a group's features stable (`REQ-STABLE-FEATURES`) and still runs only the tests of the group's crates.

Context: the research for nxr-gqad20 (14 November 2026) found that the strategy's row, "Build the whole workspace and filter which tests run", names no way to filter. `cargo test` cannot leave out whole crates without `-p` or `--exclude`, and both narrow feature resolution to the crates they name, so a step that filters that way compiles with other features than the build of the whole workspace. Every step of a group has to select crates as `DES-UNIFICATION` prescribes (`DES-BATCH`), and that includes the doctest step of `DES-TEST-RUN`. nxr-8f9dz2 implements the strategy and lists "filter which tests run" as one of its items.

Experiment, in a scratch workspace on cargo 1.100: after `cargo test --no-run --workspace`, the doctest step `cargo test --doc -p b` recompiled `shared` and `b` with different features. The same step with `--workspace` recompiled nothing. `--workspace --exclude …` narrowed feature resolution just as `-p` did. Separately, `cargo test --doc -p binonly` fails for a crate without a library ("no library targets found"), while cargo skips such a crate quietly beside crates that have one.

The research named two ways, not weighed against each other: run every test and doctest of the workspace and keep the results of the selected crates, or have the plugin run the built test binaries itself. With nextest, a filterset can select tests while the whole workspace is built; the doctests stay with `cargo test --doc`.

- [x] Agree with the maintainer how `workspace-build` filters the tests and the doctests of a group, for the `cargo` and the `nextest` runner
- [x] Record the answer in `DES-UNIFICATION`, and in `DES-BATCH` or `DES-TEST-RUN` where it concerns them, with an evidence item for the experiment; extend `VER-BATCHING` if the policies then require it

Done when: the items agree, and `mara schema validate` and `mara project validate` report `valid: true`.

Note from the review of nxr-gqad20 (14 November 2026): `cargo test` has no `--keep-going`, so a compile error in any crate that a test step compiles stops the step before any test runs (`DES-BATCH`, `EVD-CARGO-BATCH-FAILURES`). Under `workspace-build`, a test step that compiles the whole workspace therefore fails every test task of the group on a compile error in a crate outside the selection, whereas a `check` run only warns about it. Take this into account when choosing how the strategy filters tests.

## Summary of Changes

The maintainer chose "Selecting runner (Recommended)" on 14 November 2026, recorded in `ADR-TEST-SELECTING-RUNNER` with the options not taken. `DES-TEST-RUN` now specifies it: under `workspace-build` (and `hakari` where it falls back), `cargo test --workspace --no-fail-fast --config 'target.<host>.runner=["<node>","<runner>"]'`, the group in `NX_RUST_TEST_PACKAGES` as a JSON list of package names, a record of skips in `NX_RUST_TEST_RECORD` that the plugin checks after the step, a runner that fails closed, terminal output without the other crates' blocks, and for nextest `--workspace` with a `package(=…)` filterset and `--no-tests=pass` plus the doctest step through the runner. The runner is a Node script (control plane, after measuring it against `/bin/sh`); where a runner for the host is or may be configured, the group's tests run one crate per command (control plane, option (b)), with the detection rules. `DES-UNIFICATION` says how each strategy selects, and the `cargo` strategy passes `-Zfeature-unification` and the setting on the command line. `DES-BATCH` gains the runner case under "Groups of one crate" and the compile-error cost under `workspace-build`; `REQ-BATCHING` now says that a compile error stops a test step for all its tasks while `build`, `check` and `lint` keep going; `REQ-STABLE-FEATURES` and `TERM-GROUP` follow. New `EVD-WORKSPACE-TEST-SELECTION` (rerun on cargo 1.100.0 and 1.91.0, nextest 0.9.152, plus what the research report gave) and `RISK-TEST-RUNNER-MACOS` (possible, moderate); `EVD-CARGO-BATCH-FAILURES` points to the nextest run. `VER-BATCHING` and `VER-TESTING` have the cases for selection, recompilation, doctests, the empty nextest filter, a skipped test of the group, a compile error outside the group, the `cargo` strategy on stable and the user's runner. The guidance on the execution and testing pages describes the costs. nxr-8f9dz2's task list and nxr-k64tm5's `cargo` item follow the design.

Checks: `pnpm nx format:write`, `pnpm nx format:check --all`, `mara schema validate` and `mara project validate` (valid: true, evaluation complete, 0 errors, 0 warnings), `zban check`. No test run, as the change is specification only.

Rejected: (a) reading the user's runner and chaining to it, because Cargo 1.91 concatenates or prefers other runner values and `include` and `cfg` tables read differently per version; a `/bin/sh` runner, because macOS drops `DYLD_*` for system binaries; a runner that exits non-zero for unselected crates, because every run would list their targets as failed.

## Changes after review

A review of the branch (14 November 2026) found that rustdoc counts any non-zero exit of a standalone `should_panic` doctest as a pass, so a runner that failed, a Node that did not start or a program the loader could not load passed such a doctest that never ran. The runner now records every start before anything else and its end, and a test task passes only where every record of its package ends with 0 or 101 and the standalone doctests that rustdoc reports match the records (`DES-TEST-RUN`, "Evidence that the tests ran"; `EVD-TEST-RUNNER-EVIDENCE`). The runner sets `RUSTDOC_DOCTEST_BIN_PATH` for merged doctest programs, because with a runner they otherwise ran all doctests in one process and an `exit(0)` hid a failing doctest. The runner is a `/bin/sh` script on Linux and a Node script on macOS, and the list is `:a:b:`. `-p` belongs only to the cases of "Groups of one crate"; a group left with one task still selects the whole workspace. `VER-TESTING` separates the fallback from what the user's runner logs. Checks as above, rerun after merging `main` at 03bb80c.

## Changes after the second review

A second review (14 November 2026) found that a runner that ends with 0 before it records anything (`SHELLOPTS=noexec` or `onecmd` under bash as `/bin/sh`, a `NODE_OPTIONS` preload that exits) still gave successful tasks, because only standalone doctests were compared with cargo's output. `DES-TEST-RUN` now requires a record for every program that cargo's output reports: each `Running` line by real path, the standalone doctests by count, and a merged program for each block with rustdoc's merged line or without any run of libtest (`EVD-TEST-RUNNER-SILENT-EXIT`). The plugin also starts the shell runner without `SHELLOPTS` and `BASHOPTS` and hands them back to the program, without relying on it. The maintainer chose "Fail it, and explain why (Recommended)" for standalone `should_panic` doctests that end without an unwinding panic: recorded in `ADR-TEST-SELECTING-RUNNER`, `DES-TEST-RUN`, `DES-DIAGNOSTICS` and the guide. Checks as above.

## Changes after the fourth review

The fourth review found that the comparison read cargo's and rustdoc's human-readable output, which `CARGO_TERM_QUIET`, `CARGO_TERM_VERBOSE`, `[env]` and what tests print change, and every wrong pass of the four reviews lay in the doctests. The maintainer chose "Run all doctests, keep the group's results (Recommended)": test binaries keep the selecting runner, now checked against cargo's JSON messages (`cargo test --workspace --no-run`, then `--tests` with the runner, then `--doc` without one), and doctests run for the whole workspace without a runner, which makes his answer on `should_panic` doctests moot. The runner is now a Node script on both hosts and passes cargo's environment on unchanged. The doctest counts, the merged-program detection, `RUSTDOC_DOCTEST_BIN_PATH`, the `should_panic` rule and the `SHELLOPTS` launcher are gone; `ADR-TEST-SELECTING-RUNNER` records the history and `EVD-TEST-STEPS-SPLIT` the experiments. Checks as above.
