---
title: Ask for the stage owner's process start once per process
status: todo
type: task
priority: deferred
tags:
  - deferred
  - backlog
blocked_by:
  - nxr-aa287j
  - nxr-8jv932
discovered_from: nxr-e2z8sz
created_at: 2026-11-21T18:46:21Z
---

Goal: making a stage does not ask the system again for what cannot change while the process lives (`ADR-STAGED-BUILDS`, `DES-BATCH`, "Staged builds").

Context: finding 8 of the architecture audit after 0.6 (21 November 2026, at 54adf17). Wave: behavior. In `nx-rust/src/executors/stage.ts`, every `createStage` (about lines 106-112) evaluates `currentOwner()` (162-196), which reads the start time of the process itself: from `/proc` on Linux, and by running `ps -o lstart=` on other systems, once for every staged build and every test group that keeps files. `removeStaleStages` (327-371) asks whether a process runs once per stage folder, also where several folders name one process. It waits for the seam issues that change `stage.ts`.

- [ ] Compute the owner once per process, keyed by the process id so that a forked process computes its own
- [ ] Ask about each process id once within one sweep
- [ ] Unit cases with the injected liveness that `stage.spec.ts` already uses, counting the calls

Done when: the counts are as described, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
