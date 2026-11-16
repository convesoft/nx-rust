---
title: Review the decisions made in 0.3
status: todo
type: task
tags:
  - maintainer
created_at: 2026-11-16T10:47:17Z
---

Goal: the maintainer reads, once, the decisions that the control plane made on his behalf while milestone 0.3 (nextest, affected tests and the coverage baseline) was built, and overturns those he disagrees with. A decision he overturns becomes a new issue. This issue is never dispatched to a worker.

Each line says what was decided, which Mara items it rests on, and how to undo it. "Provisional" marks a decision of a kind the maintainer reserved for himself that can still be undone and was therefore taken without stopping the work.

- [ ] Read the list below and overturn what is wrong

## Decisions

1. The three spikes of 0.3 (nxr-hvw1rq and nxr-3qe5zj on `RISK-CARGO-AFFECTED`, nxr-3k3z1j on `RISK-COVERAGE-COST`) were started on 16 November 2026, before the 0.2 epic closed. They measure cargo-affected, nextest and coverage collection on a real workspace and change no code that 0.2 touches; only the features of 0.3 need the batch executor. Rests on the goal that the plugin becomes usable sooner; the order of the epics stays for everything that builds on 0.2. Nothing to undo: the spikes end in evidence items.

From the spikes on cargo-affected (nxr-hvw1rq and nxr-3qe5zj, 16 November 2026; evidence `EVD-CARGO-AFFECTED-REPORT` and `EVD-CARGO-AFFECTED-COST`). Both assumptions of `RISK-CARGO-AFFECTED` hold, with the conditions that these decisions set. All of them are in `DES-TEST-RUN` steps 1 to 4 unless another item is named.

2. The selection is passed in `-E` arguments (at most 64 KiB each, whole binaries above 512 KiB in all, no nextest run for an empty selection), not through a configuration file, because the repository's nextest `default-filter` overrides a tool configuration's. Rests on `REQ-CARGO-UNCHANGED`. Undo: step 3.
3. cargo-affected runs with git's `diff.relative`, since without it a workspace below the top of its git repository (the usual Nx layout) selects nothing and warns of nothing; and the plugin checks the report against git's own list of changed files (every collection the report rests on and the working tree, both ends of a rename, deletions, untracked files; a changed submodule or a declared input that git ignores runs the full suite). Rests on `GOAL-TRUSTED-CACHE`. Undo: step 1.
4. A report is used only when cargo-affected exits 0 with `schema_version` 1 and `hit-exact` or `hit-with-divergence`; anything else runs the full suite and the task says why. Undo: step 1.
5. The mode command reads the coverage database read-only and never starts `status`, which would build the tests at hashing time; it prints `full` when it cannot read it (`DES-TEST-MODE`). Undo: that sentence.
6. Coverage narrows only a Rust file with coverage rows, in a member that is no proc macro, that is not a build script and that no `fileInputs` names. Everything else widens by what the file is: proc-macro sources, build scripts, declared files, non-Rust files and files without rows add all tests of their crate and of every crate that depends on it; toolchain and Cargo configuration files add the whole group (`ADR-AFFECTED-TESTS-WIDENING`, from `REQ-SELECTION-SAFETY`). The review showed that a file with coverage rows of its own, such as a proc-macro crate with unit tests, would otherwise select only its own tests. Undo: step 2.
7. Whose a changed file is comes from the tasks' declared inputs across the whole repository, not from the workspace folder: shared files beside the crates and path crates elsewhere count for every crate whose `test` inputs hold them; a file that no crate of the group has as an input adds nothing; a file the plugin cannot place runs the full suite. Undo: step 2.
8. Programs started by tests: a crate with a binary target runs all its integration tests in affected mode, and every crate that depends on it (a cargo dependency of any kind, an Nx dependency, or declared inputs that reach its folder) runs all its tests when it changes. A test that starts a program without any declared relation is outside what the plugin can see. Undo: step 2.
9. A baseline is trusted only in the context it was collected in: features, profile, target triple and hashes of the declared environment inputs are recorded beside it, and a difference or a missing record runs the full suite (`ADR-AFFECTED-BASELINE-CONTEXT`, `DES-BASELINE`). cargo-affected's own fingerprint does not hold them. Undo: stop writing and comparing the record.
10. Provisional (it is a known way for an affected run to skip a failing test). Two limits stay and are stated in the user guide beside the sentence that an affected run never stands in for the full run: code that another crate evaluates at compile time (a `const fn` used in a `const`, a macro by example) leaves no coverage row for that consumer; and a build script that reads Rust source of its own crate is seen only if that file is declared in `fileInputs`. Closing either would mean widening every library change to all tests of all dependents, or every Rust file of a crate with a build script, which ends the narrowing. Rests on `RISK-CARGO-AFFECTED` (possible, major; the feature is off by default and a subset result never satisfies the full mode's key, `REQ-TEST-MODE-KEY`). Undo: take the wider rule in step 2.
11. Waiting on the maintainer, nothing depends on it: whether to report to the cargo-affected project that a workspace below the top of its git repository selects nothing without `diff.relative` (it leaves the repository; backlog issue nxr-4bhgkd).

12. The implementation issues of 0.3 that build only on the batch executor and the test steps of `workspace-build` (nxr-jb6g5y, the nextest runner, first) were started on 16 November 2026, once nxr-8f9dz2 was merged and before the 0.2 epic closed; what is left in 0.2 (the `hakari` and `cargo` strategies) does not touch them. Rests on the goal that the plugin becomes usable sooner. Nothing to undo.
