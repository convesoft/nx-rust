---
title: Check task dotenv files before building the batch dotenv layer
status: todo
type: bug
priority: deferred
tags:
  - deferred
  - backlog
discovered_from: nxr-qkxcmm
created_at: 2026-11-20T17:15:07Z
---

Goal: run `dotenvProblem` before `taskDotenvLayer` expands a task's dotenv files in `nx-rust/src/executors/batch.ts` (`DES-BATCH`, "Dotenv files").

Context: in `nx-rust/src/executors/batch.ts`, the preparation loop calls `environmentOf(task)` (`taskDotenvLayer` -> Nx's `loadAndExpandDotEnvFile`) before `prepareTask` runs `dotenvProblem`. A dotenv file whose expansion runs away only when a run-dependent variable is set — for example `B=x$B` with `VALUE=${NX_FORKED_TASK_EXECUTOR:+$B z}` — finishes cleanly in the `nx` process (where `NX_FORKED_TASK_EXECUTOR` is unset, leaving `B="x"` and `VALUE=""`) and is then refused by `dotenvProblem` when the task runs alone, whereas in a batch (where `NX_FORKED_TASK_EXECUTOR=true` in the batch process) `taskDotenvLayer` expands `$B z` and OOMs (`SIGABRT`) the whole batch process before `dotenvProblem` can refuse the task.

- [ ] Run a pre-expansion dotenv check (or move `dotenvProblem` ahead of `taskDotenvLayer`, taking care with how ambient command values are supplied) in `batch.ts` so a task whose dotenv files reference a run-dependent variable fails before `loadAndExpandDotEnvFile` expands them
- [ ] Add a test covering a dotenv file whose runaway expansion is guarded by a run-dependent variable (such as `B=x$B` and `VALUE=${NX_FORKED_TASK_EXECUTOR:+$B z}`) in a batch
