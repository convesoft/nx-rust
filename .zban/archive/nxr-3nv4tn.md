---
title: Confirm per-task results and caching from an Nx batch executor
status: done
type: task
priority: high
tags:
  - spike
parent: nxr-9y4eh8
created_at: 2026-11-12T18:20:01Z
closed_at: 2026-11-14T15:21:25Z
---

Goal: confirm or refute the assumptions in `RISK-BATCH-BEHAVIOUR` (`nx-rust/docs/decisions.mara.md`). `DES-BATCH` rests on them.

- [x] A batch executor with `preferBatch: true` is batched without `--batch` and returns a result per task
- [x] Nx hashes, restores and stores each task of a batch on its own, and a restored task is left out of the batch
- [x] Terminal output is attributed per task
- [x] Whether other tasks still do not start while a batch runs on Nx 24, with the published repro
- [x] Record the finding as an evidence item (`EVD-`) in `nx-rust/docs/decisions.mara.md` that supports or contradicts the items above
- [x] Update the risk (likelihood, consequence, or retire it) and every design or decision the finding changes

Done when: the evidence item is accepted in Mara, and `mara project validate` reports `valid: true`.

## Summary of Changes

- Experiments on Nx 24.0.6 in a throwaway workspace with a stand-in batch executor, the published reproduction (ineentho/nx-batch-parallelism-repro at 90cdbe8, its implicit dependencies respelled `batch-a` because Nx 24.0.6 rejects `:batch-a`) and a small Cargo workspace, plus a reading of the installed `nx` package, recorded as `EVD-NX-24-BATCHES` in `nx-rust/docs/decisions.mara.md`. It supports `ADR-BATCH-EXECUTOR` and `RISK-BATCH-BEHAVIOUR`.
- Confirmed: an executor with `preferBatch` is batched without `--batch`; each task of a batch keeps its own status, key, restore, cache entry and terminal output; a restored task is left out of the batch; no other task starts while a batch runs (the reproduction behaves the same on 24.0.6).
- Refuted for `DES-BATCH`: Nx stores the outputs of a batch's tasks only when the whole batch has ended, so a later group can change what Nx stores for an earlier task (a `test` group after a `build` group stored the `test` build's executable under the `build` key). Not redesigned here: filed as nxr-1q1f0n for the maintainer, and nxr-s12cpg is now blocked by it and cites the evidence.
- `RISK-BATCH-BEHAVIOUR` updated with nxr-6m0mqh (consequence `moderate` → `major`, likelihood stays `likely`).
- Checks: `mara schema validate` and `mara project validate` (valid: true, evaluation complete, no errors or warnings), `pnpm nx format:check --all`, `zban check`. No test suite: the change is knowledge only.

Review fixes (reproduced before writing): `EVD-NX-24-BATCHES` and `RISK-BATCH-BEHAVIOUR` now state the conditions of the unknown status (streamed results stop Nx, results in one object do not), of `NX_CACHE_FAILURES=true` (failures stored and replayed, also after a throw) and of a result without terminal output (it fails when Nx stores it, and passes with `--skip-nx-cache`). The evidence also records that a later `cargo test` replaces a restored `build` executable on disk, with or without a batch, and nxr-1q1f0n carries that constraint. The plugin as it is on `main` stores and replays failures under `NX_CACHE_FAILURES=true`, which contradicts accepted items: filed as nxr-9bpbsa. Checks after merging `main` (3445ae7): `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` (valid: true, evaluation complete, no errors or warnings), `zban check`.
