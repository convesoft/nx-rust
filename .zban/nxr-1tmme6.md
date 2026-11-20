---
title: Build input check reads Nx's process-wide workspace context, which misses files cargo wrote after its first use
status: todo
type: bug
priority: high
parent: nxr-e2z8sz
discovered_from: nxr-3f5wqp
created_at: 2026-11-20T14:35:45Z
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

- [ ] Reproduce in a batch: a later group's build script writes a file into a folder it names with `rerun-if-changed`, and the check misses it
- [ ] Check whether a non-batch task's process creates the workspace context before cargo
- [ ] Record in Mara the approach that the control plane settles (both options above touch a rule: the first changes a process-wide singleton of Nx, the second lists files with the plugin's own walk instead of Nx's), then implement and test it
