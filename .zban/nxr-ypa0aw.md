---
title: Decide how the workspace-build strategy filters which tests run
status: todo
type: task
tags:
  - spec
parent: nxr-9y4eh8
related:
  - nxr-8f9dz2
discovered_from: nxr-gqad20
created_at: 2026-11-14T15:08:21Z
---

Goal: `DES-UNIFICATION` says how the `workspace-build` strategy filters which tests run, so that a batched `test` run under it keeps a group's features stable (`REQ-STABLE-FEATURES`) and still runs only the tests of the group's crates.

Context: the research for nxr-gqad20 (14 November 2026) found that the strategy's row, "Build the whole workspace and filter which tests run", names no way to filter. `cargo test` cannot leave out whole crates without `-p` or `--exclude`, and both narrow feature resolution to the crates they name, so a step that filters that way compiles with other features than the build of the whole workspace. Every step of a group has to select crates as `DES-UNIFICATION` prescribes (`DES-BATCH`), and that includes the doctest step of `DES-TEST-RUN`. nxr-8f9dz2 implements the strategy and lists "filter which tests run" as one of its items.

Experiment, in a scratch workspace on cargo 1.100: after `cargo test --no-run --workspace`, the doctest step `cargo test --doc -p b` recompiled `shared` and `b` with different features. The same step with `--workspace` recompiled nothing. `--workspace --exclude …` narrowed feature resolution just as `-p` did. Separately, `cargo test --doc -p binonly` fails for a crate without a library ("no library targets found"), while cargo skips such a crate quietly beside crates that have one.

The research named two ways, not weighed against each other: run every test and doctest of the workspace and keep the results of the selected crates, or have the plugin run the built test binaries itself. With nextest, a filterset can select tests while the whole workspace is built; the doctests stay with `cargo test --doc`.

- [ ] Agree with the maintainer how `workspace-build` filters the tests and the doctests of a group, for the `cargo` and the `nextest` runner
- [ ] Record the answer in `DES-UNIFICATION`, and in `DES-BATCH` or `DES-TEST-RUN` where it concerns them, with an evidence item for the experiment; extend `VER-BATCHING` if the policies then require it

Done when: the items agree, and `mara schema validate` and `mara project validate` report `valid: true`.

Note from the review of nxr-gqad20 (14 November 2026): `cargo test` has no `--keep-going`, so a compile error in any crate that a test step compiles stops the step before any test runs (`DES-BATCH`, `EVD-CARGO-BATCH-FAILURES`). Under `workspace-build`, a test step that compiles the whole workspace therefore fails every test task of the group on a compile error in a crate outside the selection, whereas a `check` run only warns about it. Take this into account when choosing how the strategy filters tests.
