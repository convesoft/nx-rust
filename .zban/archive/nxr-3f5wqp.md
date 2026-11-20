---
title: Memoize the workspace-wide glob in nxTaskFiles.filesBelow
status: done
type: task
parent: nxr-e2z8sz
blocked_by:
  - nxr-gtxq18
created_at: 2026-11-20T10:24:44Z
closed_at: 2026-11-20T14:54:25Z
---

Goal: `nxTaskFiles.filesBelow` caches the workspace-wide glob result instead of walking the repository on every call.

Context: in `nx-rust/src/executors/nx-task-files.ts`, `filesBelow(folder)` calls `glob(context.root, ["**/*"])` on every invocation. `nx-rust/src/executors/input-check.ts` invokes `files.filesBelow(folder)` inside a loop over folders (`DES-BUILD-INPUT-CHECK`), causing repeated full-repository globs during a single build input check.

- [x] Lazily compute and memoize `glob(context.root, ["**/*"])` once per `nxTaskFiles` instance in `nx-rust/src/executors/nx-task-files.ts`
- [x] Add a unit test verifying `glob` is invoked at most once across multiple `filesBelow` calls on the same `NxTaskFiles` instance

Done when: the new unit test passes, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Summary of Changes

- `nxTaskFiles` in `nx-rust/src/executors/nx-task-files.ts` lists the repository with Nx's glob once, on the first `filesBelow` call, and filters that list for every later folder. The list is held by the instance and given out as a copy, so a caller cannot change what later calls see.
- Lifetime relied on: `checksAfterCargo` (`task.ts`, also used per member by `group-run.ts` for batches) makes one instance per task check, after the cargo call that the check judges. The instance is used only within that check's `checkBuildInputs` loop, which writes no files, and is then dropped. No instance outlives a cargo call or serves two tasks.
- New `nx-rust/test/nx-task-files.spec.ts`: glob runs once across four `filesBelow` calls (counting stub); callers cannot mutate the list; a file written between two checks is seen by the second (fails with a module-level memo); with the real Nx glob in a fixture, a file written after the instance is made and before its first use is listed. The new tests fail against the old code (glob count) and against a memo shared across instances.
- `DES-BUILD-INPUT-CHECK`, point 5: records that a check lists the repository once and that the list serves that check alone.
- Checks run: `pnpm nx test nx-rust --testPathPatterns=nx-task-files` (4 passed), `pnpm nx run-many -t build lint test` (8 tasks succeeded), `pnpm nx format:check --all` (clean), `mara schema validate` and `mara project validate` (valid, evaluation complete, 0 errors, 0 warnings), `zban check` (clean).

## Decisions made

- The memo is scoped to one `nxTaskFiles` instance, which is one task's check after its cargo call. It is not shared across the tasks of a batch or across cargo calls. Recorded in `DES-BUILD-INPUT-CHECK`, point 5.

## Found, filed separately

- nxr-1tmme6: Nx's in-process workspace context, which the glob reads, is created on first use and, in a batch worker, is not refreshed between the cargo calls of two groups (a graph rebuild refreshes it). In a batch, a later group's check can therefore enumerate an older list. The memo is not the cause.
