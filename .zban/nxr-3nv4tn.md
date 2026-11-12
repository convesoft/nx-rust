---
title: Confirm per-task results and caching from an Nx batch executor
status: todo
type: task
priority: high
tags:
  - spike
parent: nxr-9y4eh8
created_at: 2026-11-12T18:20:01Z
---

Goal: confirm or refute the assumptions in `RISK-BATCH-BEHAVIOUR` (`nx-rust/docs/decisions.mara.md`). `DES-BATCH` rests on them.

- [ ] A batch executor with `preferBatch: true` is batched without `--batch` and returns a result per task
- [ ] Nx hashes, restores and stores each task of a batch on its own, and a restored task is left out of the batch
- [ ] Terminal output is attributed per task
- [ ] Whether other tasks still do not start while a batch runs on Nx 24, with the published repro
- [ ] Record the finding as an evidence item (`EVD-`) in `nx-rust/docs/decisions.mara.md` that supports or contradicts the items above
- [ ] Update the risk (likelihood, consequence, or retire it) and every design or decision the finding changes

Done when: the evidence item is accepted in Mara, and `mara project validate` reports `valid: true`.
