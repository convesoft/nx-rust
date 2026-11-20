---
title: Build input check can take another Nx process's file scan that began before the group's cargo call
status: todo
type: bug
priority: deferred
tags:
  - deferred
  - backlog
discovered_from: nxr-1tmme6
created_at: 2026-11-20T19:34:49Z
---

Goal: the build input check lists the repository's files as they are after the group's cargo call also while another Nx process scans the same repository (`DES-BUILD-INPUT-CHECK`, point 5), or the limit is settled as accepted.

Context: nxr-1tmme6 clears Nx's workspace context after a group's cargo call, so the next read makes a new native context. In Nx 24.0.6 that context's first walk goes through `acquire_files` (`packages/nx/src/native/workspace/context.rs`, lines 195-295): where another process holds `nx_files.lock` because it is walking, the new context waits and takes the archive that walk writes, if it was written after the wait began, instead of walking itself (`EVD-NX-24-WORKSPACE-CONTEXT`). If that other walk listed a folder before cargo wrote a file into it, the check works on a list older than the cargo call and can miss an undeclared file in a folder that a build script names, so a success can be cached under a key that misses it (`GOAL-TRUSTED-CACHE`).

It needs a second process walking at that moment: an nx command's main process at start or while it builds a graph without the daemon, the daemon at its start or after it resets its state, or another task or batch process making its context, such as a check of a task that runs in parallel. Not reproduced; reasoned from the source.

No small remedy within the settled approach: `setupWorkspaceContext` takes only `watch` and `alwaysWatch`, and every walk, `refresh` included, shares through the lock. `NX_WORKSPACE_WALK_WAIT_MS=0` would make the context walk alone, but it is read from the process environment, which the plugin must not change as a workaround. Options to weigh: a short-lived child process per group check with that variable set (the alternative named when nxr-1tmme6 was settled), asking Nx upstream for an option, or accepting the limit as `ADR-TEST-AFTER-BUILD` and `RISK-ARTIFACT-DIR-WRITERS` accept overlapping Nx commands.

- [ ] Reproduce with a second process holding the files lock during a group's check, or show it cannot be reached in practice
- [ ] Decide with the maintainer between a remedy and accepting the limit, and record it in Mara
