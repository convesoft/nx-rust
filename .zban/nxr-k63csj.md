---
title: Review and harden unreported-task deferral in batch.ts
status: in-progress
type: task
priority: low
parent: nxr-e2z8sz
related:
  - nxr-5rrkay
  - nxr-fpc72j
created_at: 2026-11-20T10:24:51Z
---

Goal: verify or replace the batch executor's unreported-task deferral pattern so it is either explicitly guarded against Nx batch-runner changes or replaced by a documented contract.

Context: in `nx-rust/src/executors/batch.ts`, when two groups in one batch would write to the same stored artifact files (`writesStoredFiles`), the batch intentionally omits the second group from yielded `BatchReport` results (`deferred`) so Nx's orchestrator treats them as unfinished and schedules a follow-up batch after storing the first group's outputs (`DES-BATCH`, `EVD-NX-24-BATCHES`, `RISK-UPSTREAM-CHANGES`).

- [ ] Verify how Nx 24's batch runner handles omitted tasks across edge cases (all-deferred guards, `--output-style`, TUI, `--skip-nx-cache`, dependent tasks outside the batch) and document the exact invariants
- [ ] Decide whether to keep unreported-task deferral with stronger regression tests or replace it with an explicit strategy (e.g. failing with guidance or staging outputs) and coordinate with `nxr-fpc72j` and `nxr-5rrkay`
- [ ] Update `DES-BATCH` and `VER-BATCHING` if the strategy changes

Done when: the batch deferral behaviour is either hardened with explicit tests or replaced cleanly, Mara validation passes, and `pnpm nx run-many -t build lint test` and `pnpm nx e2e nx-rust-e2e` pass.
