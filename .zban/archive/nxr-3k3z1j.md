---
title: Benchmark coverage collection
status: done
type: task
tags:
  - spike
parent: nxr-m3k3w8
created_at: 2026-11-12T18:20:01Z
closed_at: 2026-11-16T15:54:29Z
---

Goal: put numbers on `RISK-COVERAGE-COST` (`nx-rust/docs/decisions.mara.md`). `DES-BASELINE` runs collection on every main commit.

- [x] Time `cargo affected collect` and `collect --diff` on a real workspace against a plain full test run
- [x] Check whether instrumented and normal builds evict each other in one build directory
- [x] Say whether a separate build directory for coverage builds should be the default
- [x] Record the finding as an evidence item (`EVD-`) in `nx-rust/docs/decisions.mara.md` that supports or contradicts the items above
- [x] Update the risk (likelihood, consequence, or retire it) and every design or decision the finding changes

Done when: the evidence item is accepted in Mara, and `mara project validate` reports `valid: true`.

## Summary of Changes

Measured on ripgrep (`178cc02`, 10 members, 1,220 tests) and rust-analyzer (`15d97b98ea`, 46 members, 8,314 tests) with cargo 1.100.0, cargo-affected 0.4.1 and cargo-nextest 0.9.152, at `-j 4` and 4 test threads in an 8 GiB memory group, three runs each under `berth -x`. Recorded as `EVD-COVERAGE-COLLECT-COST` (accepted).

- ripgrep: full `collect` 12.5–13.1 s, `collect --diff` 1.1–2.5 s against a plain run of 3.2–3.7 s; database 53 MB.
- rust-analyzer: full `collect` 645–656 s (plain run 21 s warm, 56–60 s cold); `--diff` 52–65 s with no Rust change, 92–94 s after a leaf change, 749–824 s after a core change; database 8.75 GB (404 MB with zstd); peak 6.8 GiB with page cache.
- A full `collect` over the previous database took 957 s against 652 s into an empty one.
- No eviction: with a shared `build.build-dir`, and even in one target directory, normal and instrumented builds alternated without recompiling, once build scripts write their profiles where cargo-affected puts them.

Changed in Mara: `RISK-COVERAGE-COST` (likely, moderate, new text), `DES-BASELINE` (a full collect starts without the old database; no separate build directory by default, with the switch kept for CI cache size; measured costs), the user guidance in `ci.mara.md` (cost table, when selection pays, parallelism and memory). The task list of nxr-d0t9vm gained the database removal and the guidance for the CI example.

Not run: macOS, a CI runner, Cargo 1.91 (ripgrep needs rustc 1.96), tokio's `--diff`. Rejected approaches: an instrumented build without `LLVM_PROFILE_FILE` for the eviction check, which wrote profiles into crate folders and caused rebuilds that cargo-affected does not cause; timings at the default 32 jobs and threads, taken while the machine swapped and once during an out-of-memory kill.

Checks run: `mara schema validate`, `mara project validate` (`valid: true`, evaluation complete), `pnpm nx format:check --all`, `zban check`. No test suite: the change is documents only.

Review round: `DES-BASELINE` now removes the context record before every collection and writes it only after success (failure case added to `VER-TESTING` and nxr-d0t9vm); the guidance, `RISK-COVERAGE-COST` and `EVD-COVERAGE-COLLECT-COST` now say that slow tests make a workspace a candidate only, name what was not measured, and give the commands to measure representative changes; `DES-BASELINE` says what an unmeasured older Cargo could cost.
