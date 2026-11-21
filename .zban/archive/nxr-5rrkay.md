---
title: Review the decisions made in 0.2
status: done
type: task
tags:
  - maintainer
created_at: 2026-11-16T10:41:38Z
closed_at: 2026-11-21T20:38:31Z
---

Goal: the maintainer reads, once, the decisions that the control plane made on his behalf while milestone 0.2 (batching and feature unification) was built, and overturns those he disagrees with. A decision he overturns becomes a new issue. This issue is never dispatched to a worker.

Each line says what was decided, which Mara items it rests on, and how to undo it. "Provisional" marks a decision of a kind the maintainer reserved for himself (cache correctness, a capability users see) that can still be undone and was therefore taken without stopping the work. Decisions before 15 November 2026, 16:30, are in the Mara items themselves and in the maintainer's own answers; this list starts with the amendments of that day.

- [x] Read the list below and overturn what is wrong

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

From nxr-8f9dz2 (feature sets and the `workspace-build` strategy, merged on 16 November 2026: Rust tasks batch without a flag and the tasks of a group share cargo commands). The maintainer's own answers of 15 November 2026 are not listed (cargo's output while a batch runs; batched tasks with a continuous dependency; the two per-crate Nx variables left out of cargo's environment, `ADR-TASK-NAME-VARIABLES`; a `test` waits for the builds whose executables a workspace test command rebuilds, `ADR-WORKSPACE-TEST-EXECUTABLES`).

9. The builds that a `test` waits for are those of every crate with a binary and an integration test or bench, its own included, the crates that the existing own-crate rule counts; on Cargo 1.91.0 and 1.100.0 a whole-workspace test replaced exactly those crates' executables. The cost: a change to such a binary crate reruns every test of the workspace, and `nx affected -t test` selects them all, since Nx counts a task's dependencies in its key. Rests on `ADR-WORKSPACE-TEST-EXECUTABLES`, `DES-TARGETS`. Undo: `testBuilds` in `nx-rust/src/graph/targets.ts`.
10. A crate used as another member's build-dependency compiles once more in the test binaries' step than under plain `cargo test`, because that step builds no doctests; accepted as a cost and named as an exception in `VER-CARGO-UNCHANGED`. Avoiding it would mean running doctests through the runner, which `DES-TEST-RUN` excludes. Rests on `DES-TEST-RUN`, `REQ-CARGO-UNCHANGED`, `EVD-TEST-STEPS-SPLIT`.
11. The selecting runner creates its record folder where it is missing, so that a step's printed verbose command still runs when pasted by hand; a folder it cannot write still fails closed. Rests on `REQ-VERBOSE-COMMAND`. Undo: the `mkdir` in `test-runner.ts`.
12. The `all-features` configuration exists on every compiling target, the workspace's `doc` included. Rests on `DES-FEATURE-SETS`. Undo: `inferredTarget` in `targets.ts`.
13. The "equivalent plain cargo commands" of `VER-CARGO-UNCHANGED` are, under `workspace-build`, the whole-workspace commands: plain `cargo build -p <crate>` can compile again after the plugin's whole-workspace builds, while plain cargo that also builds the whole workspace finds everything fresh. Rests on `DES-UNIFICATION`.
14. No cargo command of a batch may write a file that another task of the batch stores, unless that task's own command runs later (`DES-BATCH`, "Files that a batch stores"). The review had shown a binary built with another crate's feature set stored under the wrong key. So a crate whose own options set `features`, `allFeatures` or `noDefaultFeatures` always forms a group of one crate that builds only that crate, also for `check`, `lint` and `test`, and such groups run after the whole-workspace groups. "Own options" means the target's options without its configuration, so a feature set from `targetDefaults` counts as the crate's own, which costs speed and never a result. Rests on `GOAL-TRUSTED-CACHE`, `REQ-STABLE-FEATURES`, `EVD-CARGO-ARTIFACT-WRITERS`. Undo: `groupKey` in `groups.ts`, `setsFeatureSet` in `task.ts`.
15. Where two whole-workspace `build` groups of one workspace root are in one batch and no order helps, the second is left unreported, so that Nx runs it in a following batch after it has stored the first (`EVD-NX-24-BATCHES`, "Tasks left out"); chosen over failing those tasks with guidance. The files a build writes are keyed by workspace root alone, not by profile and triple, since profiles share folders. Undo: fail instead of deferring, in `batch.ts`, with a row in `DES-DIAGNOSTICS`.
16. Cargo's human-readable output is matched on a copy without terminal escape sequences wherever the plugin reads it, and each task's output keeps the lines as cargo wrote them; `CARGO_TERM_COLOR=always` had made an unrelated failing doctest fail a passing task. Nothing to undo.
17. Provisional (cache correctness with batching switched off). With `--batch=false` and `--parallel`, a whole-workspace build may re-link another build's executable while Nx is storing it; not reproduced, the fix is not small, and it went to the backlog as nxr-fpc72j with one sentence in `DES-BATCH` naming the limit. Undo: pull the issue back.

From nxr-k64tm5 with the rest of nxr-pht7d6 (the `hakari` and `cargo` strategies, merged on 16 November 2026; all in `DES-UNIFICATION` unless another item is named).

18. The strategy and the hakari `platforms` are stored in each project's metadata, and an executor that finds no strategy recorded treats the workspace as `workspace-build`, which matches the keys such a graph has. Undo: the paragraph "Where the executor reads it" and `prepareTask`.
19. Everything the plugin cannot determine falls back to `workspace-build`, with a warning that names the failing check: a hakari configuration that is no valid TOML, a `platforms` that is no list of strings, a host for which `rustc -vV` names no triple; a setting that the fourth check requires to be empty counts as empty only if every list inside it is. At task time an unknown host or a triple the plugin cannot name gives a group of one crate. Rests on `GOAL-TRUSTED-CACHE`. Undo: `unification.ts`, `groups.ts`.
20. Under `cargo`, the two unification flags go on every compiling command, groups of one crate, `doc`, `bench` and `run` included. Undo: "How each strategy selects".
21. The rule that no cargo command of a batch writes a file another task of the batch stores now works per crate, so that it also covers groups that select crates with `-p` (`DES-BATCH`, "Files that a batch stores"). Undo: `writesStoredFiles` in `batch.ts`.
22. A task "shared its command" only where the command selected more than its own crate; only then does the post-check under `hakari` compare every member's digest (`DES-LOCKFILE-HASHING`, "Post-check").
23. `VER-BATCHING` was changed so that the test harness writes the hakari fixtures exactly as cargo-hakari 0.9.39 generates them, with one test that confirms the match with the real tool; the grouping tests otherwise use a stand-in for the tool.
24. Provisional (a capability the design names and v1 will not have unless the maintainer says otherwise). The optional strict per-crate build target of the `hakari` strategy was not built: no cargo command line builds a crate without the hack crate, and cargo-hakari's own way rewrites manifests, which `REQ-NO-MANIFEST-WRITES` forbids (`EVD-HAKARI-UNIFICATION`, "Without the hack crate"). It waits in the backlog as nxr-ys8rx5 and needs the maintainer's word on how such a build should work. Undo: pull the issue back.
25. Two exotic findings went to the backlog: nxr-x7kn5n (members that declare the hack crate as an optional dependency and never enable it pass all four checks and cargo-hakari's own verification, yet get different features alone and in a group under one key; cargo-hakari itself writes that dependency as not optional) and nxr-3d9kmn (the lockfile task cannot read a `Cargo.lock` with two packages of one name and version from different git sources). Undo: pull an issue back.

## The maintainer's review of the provisional lines (20 November 2026)

- Lines 3, 17 and 24 stand.
- Line 8 is overturned: nxr-8paqsn is pulled back from the backlog and investigated before 1.0, because Cargo 1.91 is the compatibility floor on account of `build.build-dir` and the failure is deterministic.

The marks of the confirmed lines are removed by nxr-qw96ne.

Outcome of line 8 (nxr-8paqsn, merged 20 November 2026 as ec5cfaa): the failure is a defect of Cargo 1.91.0, not of the plugin, Nx or the harness. With a build directory apart from the artifact directory, Cargo 1.91 names a file generated in `OUT_DIR` under the artifact directory in the dependency file beside the artifact; Cargo 1.92 fixed it (rust-lang/cargo#16092). The plugin needed no change, because the build input check skips both directories; the review confirmed that no input is lost on 1.91. The test now expects each version's path and fails on both without the skip (`EVD-CARGO-DEP-INFO`).

## Summary of Changes

Maintainer final review completed on 21 November 2026. All remaining non-provisional lines stand (line 15 is superseded by staged builds in 0.6). No further follow-up issues needed.
