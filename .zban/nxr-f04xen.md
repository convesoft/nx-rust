---
title: Hash a build that a batch left for a following batch again once the builds it depends on have run
status: todo
type: task
priority: deferred
tags:
  - deferred
  - backlog
discovered_from: nxr-k63csj
created_at: 2026-11-20T13:58:32Z
---

Goal: a `build` that the batch executor leaves for a following batch is stored under the cache key that Nx would compute once its dependencies have run, so that a repeated command restores it (`DES-BATCH`, "Tasks left for a following batch"; `EVD-NX-24-BATCHES`).

Context: found by the review of nxr-k63csj at commit f008376. Nx 24.0.6 hashes every task of a batch before the batch runs, and keeps that hash for a task that the batch left out (`applyFromCacheOrRunBatch` in `nx/dist/src/tasks-runner/task-orchestrator.js`); by the time the task runs, Nx has removed its completed dependency and does not hash again. Reproduction of the reviewer: in the three-wave fixture of `nx-rust/test/batch-deferral.spec.ts`, add `{ "dependentTasksOutputFiles": "**/pb" }` to the inferred `build` inputs through `inputs: ["...", …]`, run the three builds cold, delete the executables but keep the cache, and repeat the command: `pa` and `pb` are restored, and `pc` runs cargo again. The cost is a cache miss, never a wrong hit, and it needs a `build` that declares another build's output files as an input, as for a code generator.

- [ ] Check whether the same early hash applies to a batch that leaves no task out, and whether Nx offers the executor a way to have a task hashed again
- [ ] Remove the limit, or keep its sentence in `DES-BATCH` and close this issue with the reason

Done when: the repeated command restores all three builds, or the limit is recorded as accepted, and `pnpm nx run-many -t build lint test` passes.
