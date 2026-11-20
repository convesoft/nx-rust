---
title: Build input check reads Nx's process-wide workspace context, which misses files cargo wrote after its first use
status: done
type: bug
priority: high
parent: nxr-e2z8sz
blocked_by:
  - nxr-aqgka5
discovered_from: nxr-3f5wqp
created_at: 2026-11-20T14:35:45Z
closed_at: 2026-11-20T19:06:33Z
---

Goal: the build input check (`DES-BUILD-INPUT-CHECK`, points 5 and 6) lists the repository's files, and matches the task's inputs, as they are after the cargo call it judges, also in a batch (`DES-BATCH`).

Context: found while working on nxr-3f5wqp. `globWithWorkspaceContextSync` of Nx 24.0.6 (`nx/src/utils/workspace-context`) creates its `WorkspaceContext` on first use and, in a batch worker, nothing refreshes it between the cargo calls of two groups; a graph rebuild without the daemon (`createProjectGraphAsync()`) does refresh it. Within such a span, a file written after a glob is missing from later globs: reproduced with a fixture under `$TMPDIR` (glob, write `src/b.rs`, glob again: both list only `src/a.rs`). The review of nxr-3f5wqp reproduced it end to end: with Cargo 1.100.0 and Nx 24.0.6's real workspace context and `HashPlanInspector`, two cargo groups in one batch worker missed the undeclared file that the second group wrote, the same at 5ae0c39 and at b9c7eba, while a control caught the same undeclared file when it existed before the batch. `HashPlanInspector` reads the same module, so `inputFiles` may be equally old.

Where this bites:
- The batch executor runs every group's cargo call and check in one process. The first check creates the context; a later group's check enumerates a folder that its build script names (`rerun-if-changed=<dir>`) from that older list, so a file a later cargo call wrote there goes unchecked and its task can be cached under a key that misses it (`GOAL-TRUSTED-CACHE`).
- A non-batch task is safe only if nothing in its process uses the workspace context before cargo runs; not yet checked.
- For a file a record names directly, an older `inputFiles` makes the check fail falsely rather than pass.

The memo of nxr-3f5wqp lives within one check and is not the cause.

Options to weigh (the fix touches `nx-rust/src/compatibility/nx-bridge.ts`, which needs coordination):
- Call Nx's `updateFilesInContext` or `refreshWorkspaceContext` before each check. Both change Nx's process-wide singleton, which the task's rules ask to avoid as a workaround; weigh it against the alternatives.
- List the folders the check enumerates with the plugin's own walk under Nx's ignore rules (`filesNxSees` in `nx-rust/src/graph/visibility.ts` already reads them), leaving `inputFiles` to a separate answer.
- Decide and record in `DES-BUILD-INPUT-CHECK` which lifetime the listing relies on.

- [x] Reproduce in a batch: a later group's build script writes a file into a folder it names with `rerun-if-changed`, and the check misses it
- [x] Check whether a non-batch task's process creates the workspace context before cargo
- [x] Verify the second opinion's reading of the installed Nx (below), record the settled approach in `DES-BUILD-INPUT-CHECK` with an evidence item, then implement and test it

Settled by the control plane on 20 November 2026, after a second opinion that read and ran the installed Nx 24.0.6: clear Nx's own workspace context with `resetWorkspaceContext` (an export of `nx/src/utils/workspace-context`, the module the bridge already loads, which Nx itself calls after it wrote files) once after a group's cargo call and before that group's checks, and once before the check of a task run on its own. Not `refreshWorkspaceContext`, which returns at once while the daemon is enabled although neither the glob nor `HashPlanInspector` uses the daemon; not `updateFilesInContext`, which inserts the given paths past the ignore rules; not a reset per task, since the checks of one group's members run concurrently. Why this and not the plugin's own walk: Nx's listing and ignore rules stay the only source (the second opinion found that `createGitIgnoreChecker` misses `.git/info/exclude`, which the native walker honours), `inputFiles` from `HashPlanInspector` becomes fresh from the same snapshot as the folder listing, and it costs one warm native walk per checked group (measured: about 7 ms on this repository, about 35 ms on 10,000 files). What it gives up: it clears a process-wide singleton, which in Nx's forked batch or executor process only this plugin caused to be created, and it adds one private export, whose absence must degrade to the existing skipped-check warning (`REQ-COMPATIBILITY`). If clearing the singleton proves wrong, the alternative is a short-lived child process per group check, never the plugin's own walk. The worker verifies each of these claims against the installed `nx` before relying on it.

The remedy touches `nx-rust/src/executors/group-run.ts` and `nx-rust/src/executors/task.ts`, so it starts after nxr-aqgka5 (which changes `task.ts`).

## Summary of Changes

- `resetNxWorkspaceContext` (`nx-rust/src/executors/nx-task-files.ts`) clears Nx's workspace context through `resetWorkspaceContext`, which the workspace-context loader of `nx-bridge.ts` now loads with its shape check. `runGroup` (`group-run.ts`) calls it once after the group's cargo steps and before the members' checks, only where a member that did not fail has a build input check; `runTask` (`task.ts`) calls it before the check of a task run on its own. `nxTaskFileParts` requires the export, so where Nx lacks it the check is skipped with the existing warning, and the reset of the group does nothing.
- Where the reset sits for nxr-ffjvc9: in `runGroup`, right before `return Promise.all(members.map(... checksAfterCargo ...))`; a shared, initialised `HashPlanInspector` per group can be made right after that `resetNxWorkspaceContext(first.context.root)` call.
- Mara: `DES-BUILD-INPUT-CHECK` point 5 keeps the lifetime of nxr-3f5wqp and adds the reset; its opening paragraph names listing as well as matching. New `EVD-NX-24-WORKSPACE-CONTEXT` records what was read and run. `VER-BUILD-INPUT-CHECK` names the new cases; the diagnostics table in `setup.mara.md` names the reset.
- Tests: `nx-rust/test/build-input-check-listing.spec.ts` (new): two groups of one crate in one batch process, real cargo and real Nx, for a file written into a folder that a build script names (both fail before the fix: the second group missed its file) and for a file written into the crate's own folder (it failed falsely before the fix); a task with `--batch=false`; and a copy of Nx without `resetWorkspaceContext`, in a batch and on its own. `nx-task-files.spec.ts` checks the reset with Nx's real context and `HashPlanInspector`; `nx-bridge.spec.ts` checks the export's shape and the skipped check.

Checks run: `pnpm nx run-many -t build lint test` (77 suites, 2070 passed, 62 skipped, 6 todo), `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e` (27 passed), `mara schema validate`, `mara project validate` (valid, evaluation complete), `zban check`. The new batch tests failed before the fix and pass after it. Cargo 1.100.0 only; the Cargo 1.91 run was not done, since nothing here depends on the Cargo version.

## Decisions made

- The mirror case uses a file in the crate's own folder, not a `fileInputs` pattern: the plugin makes `fileInputs` into `includeIgnored` filesets, which Nx reads from the disk, so a declared file never depended on the context (recorded in `EVD-NX-24-WORKSPACE-CONTEXT` and `DES-BUILD-INPUT-CHECK` point 5).
- The batch tests give each crate's `build` a feature set of its own, so that both groups run in one batch process: under `workspace-build` a second `build` group of a workspace is left for a following batch process, and groups of two workspaces waited for different lockfile tasks, so neither reproduced the defect.
- The reset is required by `nxTaskFileParts`, the same as the glob and the inspector, so a check never runs without it; `resetNxWorkspaceContext` swallows only the missing-part error and leaves the warning to each check.
- The reset in `runGroup` happens only where a member that did not fail has a build input check, so `test` and `check` groups do not load Nx's module for it. `DES-BUILD-INPUT-CHECK` point 5 now says so, and that the reset is one of the three parts of Nx the check needs.
- After review: a context made after the reset can still take the walk of another Nx process that holds `nx_files.lock` at that moment, and that walk can predate the cargo call (Nx 24.0.6 `context.rs`, `acquire_files`; read, not run). Nothing in `nx/src/utils/workspace-context` turns the sharing off; only the environment variable `NX_WORKSPACE_WALK_WAIT_MS`, which the plugin must not set as a workaround. The control plane decided the limit does not hold this change back: point 5 states it, `EVD-NX-24-WORKSPACE-CONTEXT` records the reading and which processes walk, and nxr-tfha8g carries it. The evidence item also now says correctly when the daemon resets its context and which early returns `refreshWorkspaceContext` has.

## Issues filed

- nxr-k1ahsd (deferred, backlog): the affected-test selection reads the same context without a reset.
- nxr-tfha8g (deferred, backlog): the check can take another Nx process's walk that began before the group's cargo call.
