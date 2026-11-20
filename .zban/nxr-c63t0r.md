---
title: Decide whether the publish executor runs the dotenv check of the cargo executors
status: todo
type: task
priority: deferred
tags:
  - backlog
discovered_from: nxr-m8evx2
created_at: 2026-11-15T16:29:00Z
---

`@convesoft/nx-rust:release-publish` (nxr-m8evx2) rebuilds each task's environment in a batch as the cargo executors do (`DES-BATCH`, `taskEnvironments` with the shield for run-dependent variables), but it does not run the dotenv check (`dotenvProblem` in `nx-rust/src/executors/dotenv-check.ts`) that fails a cargo task whose dotenv files make Nx look up a variable whose value depends on how the task runs. For a publish task the difference reaches only a crate whose dotenv files in its own folder refer to such a variable, and the target is not cached, so no stored result depends on it; `DES-RELEASE` does not say either way.

- [ ] Decide in `DES-RELEASE` (or `DES-BATCH`) whether publish tasks run the check, and implement the answer with a test

Reproduction from the review of nxr-4sr6hd (20 November 2026, the same before and after that change): with `NX_TASK_TARGET_CONFIGURATION=release`, `CARGO_REGISTRY_DEFAULT=team-${NX_TASK_TARGET_CONFIGURATION}` in a crate's `.env.nx-release-publish` and `publish = ["official"]` in its manifest, a real dry run reports the registry `team-release` with `--batch=false`, and `team-` followed by the shield value of `taskEnvironments` with `--batch`. So a publish task whose dotenv file builds a value from a run-dependent variable gets a different environment in a batch than on its own, and the placeholder reaches a diagnostic; a real upload would then name a registry that does not exist. The cargo executors refuse such a task before cargo runs (`dotenvProblem`); the publish executor does not.
