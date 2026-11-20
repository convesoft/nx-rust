---
title: Memoize the workspace-wide glob in nxTaskFiles.filesBelow
status: todo
type: task
parent: nxr-e2z8sz
blocked_by:
  - nxr-gtxq18
created_at: 2026-11-20T10:24:44Z
---

Goal: `nxTaskFiles.filesBelow` caches the workspace-wide glob result instead of walking the repository on every call.

Context: in `nx-rust/src/executors/nx-task-files.ts`, `filesBelow(folder)` calls `glob(context.root, ["**/*"])` on every invocation. `nx-rust/src/executors/input-check.ts` invokes `files.filesBelow(folder)` inside a loop over folders (`DES-BUILD-INPUT-CHECK`), causing repeated full-repository globs during a single build input check.

- [ ] Lazily compute and memoize `glob(context.root, ["**/*"])` once per `nxTaskFiles` instance in `nx-rust/src/executors/nx-task-files.ts`
- [ ] Add a unit test verifying `glob` is invoked at most once across multiple `filesBelow` calls on the same `NxTaskFiles` instance

Done when: the new unit test passes, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
