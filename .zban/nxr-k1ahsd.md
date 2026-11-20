---
title: Affected-test selection may read Nx's workspace context as an earlier group of the same batch left it
status: todo
type: bug
priority: deferred
tags:
  - deferred
  - backlog
discovered_from: nxr-1tmme6
created_at: 2026-11-20T18:58:03Z
---

Goal: decide whether steps 1 and 2 of `DES-TEST-RUN` (the selection of affected tests) can place a changed file wrongly because they read Nx's workspace context as an earlier group of the same batch process left it, and fix it if so.

Context: nxr-1tmme6 found that Nx 24.0.6 makes its workspace context once per process and keeps it, also across the groups of a batch (`EVD-NX-24-WORKSPACE-CONTEXT`), and made the build input check clear it after each group's cargo call (`DES-BUILD-INPUT-CHECK`, point 5). `inputPlacement` in `nx-rust/src/executors/affected-inputs.ts` reads the same context through `HashPlanInspector.init` and `globWithWorkspaceContextSync`, before a later `test` group's nextest step, without a reset. A file that an earlier group's cargo call wrote into the repository (a build script, a test writing a file), and that counts as changed against the baseline, could then be missing from the inspector's input files and the glob. Not checked whether that leads to fewer tests than needed (a cache-correctness problem, `GOAL-TRUSTED-CACHE`) or only to the full suite.

- [ ] Find out what `owners` and the selection do with a changed file missing from the context's list, with a reproduction in a `test` batch of two groups
- [ ] If the selection can run fewer tests than needed, clear the context before the selection (as `resetNxWorkspaceContext` does for the build input check), record it in `DES-TEST-RUN` and test it
