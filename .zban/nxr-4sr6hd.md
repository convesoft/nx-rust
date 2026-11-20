---
title: Avoid mutating global process.env when building batch task environments
status: todo
type: task
parent: nxr-e2z8sz
blocked_by:
  - nxr-gtxq18
created_at: 2026-11-20T10:24:43Z
---

Goal: build each batch task's dotenv environment without mutating the batch worker's global `process.env`.

Context: `taskEnvironments` in `nx-rust/src/executors/task-env.ts` temporarily writes `process.env[name] = shieldValue` (`"\u0001@convesoft/nx-rust"`) around calling Nx's `getTaskSpecificEnv` and restores it in `finally` (`DES-BATCH`, `VER-BATCHING`). While `getTaskSpecificEnv` is currently synchronous, mutating global `process.env` with a sentinel string is fragile if any async work runs concurrently in the batch process.

- [ ] Check whether the task dotenv layer can be constructed on a local `{ ...process.env }` clone using the installed Nx's `getEnvFilesForTask`, `dotenv.parse`, and `dotenv-expand` (plus root unloading), matching `getTaskSpecificEnv` without mutating `process.env`
- [ ] Replace the global `process.env` shield mutation in `nx-rust/src/executors/task-env.ts`
- [ ] Verify equivalence with single-task runs across `VER-BATCHING` and dotenv tests

Done when: `task-env.ts` no longer mutates `process.env` during batch environment construction, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
