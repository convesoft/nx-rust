---
title: Review the decisions made in 0.2
status: todo
type: task
tags:
  - maintainer
created_at: 2026-11-16T10:41:38Z
---

Goal: the maintainer reads, once, the decisions that the control plane made on his behalf while milestone 0.2 (batching and feature unification) was built, and overturns those he disagrees with. A decision he overturns becomes a new issue. This issue is never dispatched to a worker.

Each line says what was decided, which Mara items it rests on, and how to undo it. "Provisional" marks a decision of a kind the maintainer reserved for himself (cache correctness, a capability users see) that can still be undone and was therefore taken without stopping the work. Decisions before 15 November 2026, 16:30, are in the Mara items themselves and in the maintainer's own answers; this list starts with the amendments of that day.

- [ ] Read the list below and overturn what is wrong

## Decisions

1. The batch executor (nxr-s12cpg) was integrated after its fifth fix round without a further review, and no further `.env` variants were pursued. Rests on `DES-BATCH` ("Dotenv files"), `GOAL-TRUSTED-CACHE` and the review budget. Undo: file an issue for another review of `nx-rust/src/executors/dotenv-check.ts`.
2. A task whose dotenv files define `NX_LOAD_DOT_ENV_FILES` fails, whatever the value, also where a root `.env` holds only `NX_LOAD_DOT_ENV_FILES=false`; the message says to remove the line and set the variable in the shell or the CI settings. Rests on `DES-BATCH` ("Dotenv files"): the plugin cannot tell from a file that switches loading whether Nx expanded the task's files. Undo: accept a definition in the root `.env` alone, which Nx loads when the `nx` process starts.
3. Provisional (cache correctness). Under `workspace-build` a task's key does not hold the other members' sources. A compile error in another member fails the test tasks that run in that cargo command and is no reason to run a cached one again; with `NX_CACHE_FAILURES=true` such a failure is stored under a key that does not hold its cause. Rests on `DES-INPUTS` ("Whole-workspace builds"), which scopes the key to what changes the features a crate is compiled with, and on `ADR-CACHED-FAILURES`. Undo: add every member's sources to the test keys under `workspace-build`, which ends per-crate caching of tests under the default strategy.
4. A path crate outside the workspace that any member reaches brings its declared files, variables and commands into every member's key, not only its folder (the worker had left them out; the review showed that a declared command can stand for the crate's manifest, which decides features). Rests on `GOAL-TRUSTED-CACHE` and `DES-INPUTS` ("Crates outside the workspace", "Declared files"). Undo: drop them again, which reopens that case.
5. A target names only its own member in `metadata.cargo.digests`, with `everyDigest: true`, and the executor takes the other members from the lockfile task it depends on (the review measured about 45 MB of graph metadata for 300 members with the full list on every target). Rests on `DES-LOCKFILE-HASHING` ("Post-check"); the post-check compares the same digests. Undo: write the full list again.
6. The whole-workspace keys were split out of nxr-8f9dz2 into nxr-j8mj18 and integrated before the shared cargo commands, so that `main` never has a command that selects the whole workspace without the keys that cover it. Rests on `GOAL-TRUSTED-CACHE`. Nothing to undo.
7. Moved to the backlog as low-priority or exotic, by the rules of 15 November 2026: nxr-8qb0eb (the Cargo version that a task's own environment selects), nxr-5j43c8 (tests that hide a failing command's output), nxr-4t05gq (0.3: baseline drift threshold), nxr-w7j0wn (0.4: how napi crates link under `cargo test`), nxr-atagzn (1.0: Cargo's feature-unification setting), nxr-s1nna8 (a redirection used only by a member without a project), nxr-enw1pg (no warning to other members about an outside crate Nx cannot see). Undo: give an issue its parent and priority back.
8. Provisional (compatibility). nxr-8paqsn went to the backlog: with Cargo 1.91.0 as rustup's default, one unit test fails (a crate's `.env` names `CARGO_BUILD_BUILD_DIR`, and the build's `OUT_DIR` is under `target/` all the same). Whether this is the test's assumption or a defect for users on 1.91 with that setting is not known. Rests on `REQ-COMPATIBILITY`, which the end-to-end suite checks on 1.91.0 in every integration, and on the rule that rare `.env` variants do not block. Undo: pull the issue back and investigate.

## Known limits recorded as risks, not decisions to review

`RISK-GUARD-HASH-PLAN` (the target-default guard reads input lists approximately; two rare forms can give a stale hit with a second plugin; nxr-2vzmt5 and nxr-wqwn7w wait in the backlog, with an unreviewed implementation on the local branch `fix/target-default-guard-plan`).
