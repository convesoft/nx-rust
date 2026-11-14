---
title: Reconcile one cargo call per group with the steps of a test run
status: done
type: task
tags:
  - spec
parent: nxr-9y4eh8
discovered_from: nxr-kq5pm5
created_at: 2026-11-13T10:56:01Z
closed_at: 2026-11-14T15:10:22Z
---

Goal: the batching items and the test design agree on how many commands one group of `test` tasks runs.

Context: the paragraph on groups in `DES-BATCH` (`nx-rust/docs/execution.mara.md`) says that each group is one cargo call, and `REQ-BATCHING` and `TERM-GROUP` speak of a single cargo invocation per group. `DES-TEST-RUN` (`nx-rust/docs/testing.mara.md`) has a group run a selection step, one nextest run and a separate doctest invocation. The review of pull request #8 found this; it predates that pull request.

- [x] Agree with the maintainer which items change and how, and record it in Mara
- [x] Bring the "What forms a group" guidance in `execution.mara.md` in line, and extend `VER-BATCHING` or `VER-TESTING` if the policies then require it

Done when: the items agree, and `mara schema validate` and `mara project validate` report `valid: true`.

## Summary of Changes

The maintainer agreed on 14 November 2026 to "One cargo command per step (Recommended)", option (a) of the research: a group of tasks runs one cargo command for each step of its target, so that the number of cargo commands depends on the target and never on how many tasks the group has. Every target has one step, apart from `test` with nextest, which has the selection in affected mode, the nextest run and the doctests.

- `TERM-GROUP`, `REQ-BATCHING` (title and text), `DES-BATCH` (a paragraph on steps, and the failure paragraph) and `ADR-BATCH-EXECUTOR` (its sentence that stated one call per group) now say one command per step. `DES-BATCH` also states that every step selects the crates as `DES-UNIFICATION` prescribes, so that every step resolves the same features (`REQ-STABLE-FEATURES`), that a step without crates, such as doctests where no crate has a library, is left out, and that each step runs even after an earlier step failed for some crates.
- `DES-TEST-RUN`: the first sentence and the doctest step, and one sentence that doctests are not narrowed in affected mode.
- `DES-OUTPUTS` and `ADR-ARTIFACT-DIR-OUTPUTS`: the `cargo metadata` check runs once for a group of cached `build` or `doc` tasks.
- `DES-LOCKFILE-HASHING`: the post-check runs after the last cargo call of a task or group. This is the same assumption of one call.
- `VER-BATCHING`: new title, and "with the default runner" for the check of one call per group. `VER-TESTING`: the cargo commands of a batched nextest run.
- Guidance: the top of `execution.mara.md`, its diagram, "What forms a group" and "When something fails"; the nextest paragraph of `testing.mara.md`; the product bullets, the index row and both READMEs ("one cargo call per group of tasks, not one per crate").
- Issue bodies that still said "one call per group": nxr-9y4eh8, nxr-s12cpg (this one also gained an item for the once-per-group directory check) and nxr-pht7d6.
- Filed nxr-ypa0aw: how `workspace-build` filters which tests run.

Checks: `pnpm nx format:write`, `pnpm nx format:check --all`, `mara schema validate` and `mara project validate` (`valid: true`, `evaluation_complete: true`, no errors or warnings), and `zban check`. No test run, because only text changed. The end-to-end check of the packed README reads both files when it runs, so changing the text does not break it.

## Review fixes

The control plane's review of 14 November 2026 found four points to fix in this change. Its decisions, recorded here as the control plane's and not the maintainer's:

- **A compile error in a step.** A task succeeds only when cargo reported its result. `cargo test` has no `--keep-going`, so when a test step's command stops at a compile error, every test task of that step whose tests cargo did not run fails. The message names the crates that failed to compile and says that the others were not run. The plugin does not rerun the step without the failing crate. For build-like steps, the plugin promises only what cargo's JSON messages establish. `DES-BATCH` now says so: `build`, `check` and `lint` use `--keep-going`, and a task of a failed command passes only when the JSON messages report an artifact for every target of its crate that the command builds whatever else is selected (named as `DES-BUILD-INPUT-CHECK` names them), and no error for the crate. The guidance in `execution.mara.md` names the cost of batching next to per-crate commands, and `VER-BATCHING` has the compile-error cases for `test` and `check`.
- **Doctest results.** `DES-TEST-RUN` now attributes the results of `cargo test` and of the doctest step through cargo's closing list of failed targets with their `-p <package>`, not through the `Doc-tests <library>` headers, which two packages can share. A task is never reported successful when the output cannot show that its package's tests passed; where the output is ambiguous, every task it could belong to fails and the message says why. `VER-TESTING` has the case of two packages with the same library name.
- **Summaries.** The product page, the index, both READMEs and the scenario in `artifacts.mara.md` say "one cargo command per step" or "a few cargo commands per group instead of one per crate". `VER-TARGETS` and `VER-UNKNOWN-OPTIONS` no longer promise one invocation where nextest takes several.
- **The selector step.** `VER-TESTING` checks that every step of a nextest group, the `cargo affected status` call included, gets the same package selection and feature flags.

The experiments are recorded in `EVD-CARGO-BATCH-FAILURES`. They ran on cargo 1.100.0, and the central cases were repeated on 1.91.0. nxr-8f9dz2 is now blocked by nxr-ypa0aw. nxr-sefq12 was filed for a member whose package name another package in the resolve shares, which makes `-p <name>` ambiguous. The checks were run again after merging `main` at 3445ae7: `pnpm nx format:write`, `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` (`valid: true`, evaluation complete) and `zban check`. No tests ran, because only text changed.
