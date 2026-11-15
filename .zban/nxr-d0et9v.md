---
title: Run the build input check per task in a batch
status: todo
type: feature
parent: nxr-9y4eh8
blocked_by:
  - nxr-agyqmz
  - nxr-s12cpg
related:
  - nxr-s12cpg
discovered_from: nxr-qv2cq5
created_at: 2026-11-13T12:05:43Z
---

Goal: when several `build` tasks share one cargo call, the check of `DES-BUILD-INPUT-CHECK` (paragraph "Batches") still runs for each task, and a failure fails only the tasks whose crates read an uncovered file.

Implements the batch part of `REQ-BUILD-INPUT-CHECK` in the batch executor of `DES-BATCH`.

- [ ] Run the check per task after the group's cargo call
- [ ] Keep the results of the other tasks of the group

Done when: the batch paragraph of `VER-BUILD-INPUT-CHECK` passes, and `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all` and `pnpm nx e2e nx-rust-e2e` pass.

Note from nxr-s12cpg (14 November 2026): `runGroup` (`nx-rust/src/executors/group-run.ts`) runs the check of `DES-BUILD-INPUT-CHECK` for each `build` task whose crate passed, right after its group's command, and fails only that task; the group asks cargo once for the directories. In groups of one crate, all that the batch forms until nxr-8f9dz2, the check therefore runs as for a task on its own. What stays here: the batch paragraph of `VER-BUILD-INPUT-CHECK` with real groups of several crates, which needs nxr-8f9dz2's shared commands, including the case of a feature that another crate of the command turns on.
