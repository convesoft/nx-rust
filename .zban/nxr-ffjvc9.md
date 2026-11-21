---
title: Share one initialized HashPlanInspector per batch group in the build input check
status: in-progress
type: task
parent: nxr-e2z8sz
blocked_by:
  - nxr-1tmme6
  - nxr-w6117m
created_at: 2026-11-20T16:38:35Z
---

Goal: a batch group initializes Nx's hash-plan inspector once after its cargo call, not once per crate, with no change to what the build input check accepts or refuses (`DES-BUILD-INPUT-CHECK`, `DES-BATCH`, `GOAL-TRUSTED-CACHE`). No `VER-` item changes.

Context: from the maintainer's audit of the test suites on 20 November 2026. `runGroup` (`nx-rust/src/executors/group-run.ts`, around lines 289-304) runs `checksAfterCargo` for each crate of a group in parallel, and each crate constructs a new `HashPlanInspector` and awaits `inspector.init()` (`nx-rust/src/executors/nx-task-files.ts`, around lines 99-105): one workspace and hasher initialization per crate of a multi-crate `build` batch. This is production code, and it speeds up batched builds as well as `build-input-check.spec.ts`, `napi-build.spec.ts` and the end-to-end suite. It builds on nxr-3f5wqp (the folder listing of one check), nxr-1tmme6 (a fresh workspace context after each group's cargo call) and nxr-w6117m (the split of `task.ts`), and waits for the last two.

- [ ] Create and `init()` one `HashPlanInspector` per group in `runGroup`, after the group's cargo call and after the context was cleared as nxr-1tmme6 settles it, and pass it to each member's `checksAfterCargo`; share the folder listing of that moment in the same way if it is safe
- [ ] Keep the freshness rule of nxr-1tmme6 and the lifetime that `DES-BUILD-INPUT-CHECK` records: nothing shared may outlive the group's checks or be read after a later cargo call. Update the design item's sentence on that lifetime
- [ ] A task run on its own keeps its own inspector
- [ ] Test through the real Nx batch runner and hasher that a group of several crates initializes once, and that the check still refuses an undeclared file written by that group's cargo call; give the timings before and after

Done when: the tests pass, the Mara validation passes, and `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e` and `pnpm nx format:check --all` pass.
