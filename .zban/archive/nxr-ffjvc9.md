---
title: Share one initialized HashPlanInspector per batch group in the build input check
status: done
type: task
parent: nxr-e2z8sz
blocked_by:
  - nxr-1tmme6
  - nxr-w6117m
created_at: 2026-11-20T16:38:35Z
closed_at: 2026-11-21T16:36:46Z
---

Goal: a batch group initializes Nx's hash-plan inspector once after its cargo call, not once per crate, with no change to what the build input check accepts or refuses (`DES-BUILD-INPUT-CHECK`, `DES-BATCH`, `GOAL-TRUSTED-CACHE`). No `VER-` item changes.

Context: from the maintainer's audit of the test suites on 20 November 2026. `runGroup` (`nx-rust/src/executors/group-run.ts`, around lines 289-304) runs `checksAfterCargo` for each crate of a group in parallel, and each crate constructs a new `HashPlanInspector` and awaits `inspector.init()` (`nx-rust/src/executors/nx-task-files.ts`, around lines 99-105): one workspace and hasher initialization per crate of a multi-crate `build` batch. This is production code, and it speeds up batched builds as well as `build-input-check.spec.ts`, `napi-build.spec.ts` and the end-to-end suite. It builds on nxr-3f5wqp (the folder listing of one check), nxr-1tmme6 (a fresh workspace context after each group's cargo call) and nxr-w6117m (the split of `task.ts`), and waits for the last two.

- [x] Built: one `HashPlanInspector` per group in `runGroup`, made and initialized by the first check that needs it, after the group's cargo call, the move of a staged `build` and the context reset of nxr-1tmme6, and passed to each member's `checksAfterCargo`; the folder listing stayed per check
- [x] Checked: the freshness rule held by the order of calls for a staged `build` group, for `napi-build` and `wasm-build` groups that read from the stage, for a group whose cargo call failed and for a batch of several groups; a task run on its own kept its own inspector; tests through the real Nx batch runner counted one initialization for a group of three crates, and the check still refused an undeclared file written by that group's cargo call
- [x] Measured: the cost of an inspector and of the folder listing, and the timings before and after
- [x] Not kept: by the orchestrator's decision the shared inspector did not go in; the measurements are recorded in `EVD-NX-24-WORKSPACE-CONTEXT` and `DES-BUILD-INPUT-CHECK` point 5

Done when: the tests pass, the Mara validation passes, and `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e` and `pnpm nx format:check --all` pass.

## Summary of Changes

The issue ends with a finding, not a change of code: sharing one inspector among a group's checks saves too little to justify shared state in the build input check. The source and the tests equal `main`.

What was built and checked, on the branch `kept/nxr-ffjvc9-shared-inspector` at 14c0e87: `runGroup` made one inspector source after its cargo calls and its `resetNxWorkspaceContext` call. The first check that needed an inspector made and initialized it, and the group's other checks got the same one if their project graph, root, Nx configuration and loaded parts were the same objects. A task run on its own kept its own inspector for each check. Tests counted initializations through a test-only variable that the plugin read: one for a staged batch group of three crates, two for a batch of two groups, one for a task run on its own. In the same run of three crates, the check still failed a crate for a file that its build script wrote during the group's cargo call, and still covered a file written into a crate's own folder. Negative control: with an inspector per check put back into `runGroup`, the batch test counted three initializations, all from one process, and failed. That branch passed `pnpm nx run-many -t build lint test` (80 suites, 2134 tests), `pnpm nx e2e nx-rust-e2e` (27 tests) and the same on Cargo 1.91.0.

Measurements on 21 November 2026 with Nx 24.0.6 (a Node.js script that timed the installed Nx's `HashPlanInspector` and workspace context over three rounds; `EVD-NX-24-WORKSPACE-CONTEXT`, "Cost"):

| Repository | First inspector, builds the context | Each further inspector | Glob of every file |
| --- | --- | --- | --- |
| This repository, 1,078 files | 10.5 to 14.4 ms | 1.4 to 1.6 ms | 0.8 to 0.9 ms |
| Throwaway, 30,001 files | 66 to 125 ms | 16 to 26 ms | 10 to 16 ms |

Timings, Nx run duration or Jest time, on a machine that other processes share:

| Run | Inspector per check (`main`) | Shared per group |
| --- | --- | --- |
| `build-input-check.spec.ts` | 1 min 35 s; 1 min 23 s | 1 min 26 s; 1 min 26 s |
| `napi-build.spec.ts` | 58.6 s | 57.1 s |
| Batched build of three crates, measured alone | 1.87 s | 1.77 s; 2.15 s |

The audit expected sharing to speed up batched builds and these suites. It did not: the first inspector after a reset builds the workspace context, and a group needs that once whether the inspector is shared or not; each further inspector only reads the built context, about 1.5 ms per crate here and 16 to 26 ms at 30,000 files, and the cargo call and the start of Nx dominate every run. The folder listing costs less still, and only checks whose records name a folder take it.

Changed in this branch: `DES-BUILD-INPUT-CHECK` point 5 now says that each check makes its own inspector and listing, also in a group of several crates, with the costs and a reference to `EVD-NX-24-WORKSPACE-CONTEXT`, whose "Cost" bullet holds the measurements and timings.

Checks run in this branch: `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` (valid, evaluation complete) and `zban check`. The suites were not run again, because the source and the tests equal `main`.

## Decisions made

- The orchestrator decided that the shared inspector does not go in: the saving does not justify shared state between checks, an identity rule for when sharing is allowed and a test-only variable read by production code in the part of the plugin that guards cache correctness. The implementation is kept on the branch `kept/nxr-ffjvc9-shared-inspector` at 14c0e87.
- Each check keeps its own folder listing as well, for the same reason and because it costs less than an inspector (`DES-BUILD-INPUT-CHECK` point 5).
