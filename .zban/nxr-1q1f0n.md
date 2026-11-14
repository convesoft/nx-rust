---
title: Decide how a batch keeps a later group from changing the outputs that Nx stores for an earlier task
status: todo
type: task
priority: high
tags:
  - spec
parent: nxr-9y4eh8
discovered_from: nxr-3nv4tn
created_at: 2026-11-14T15:19:05Z
---

Goal: `DES-BATCH` keeps `GOAL-TRUSTED-CACHE` on Nx 24: Nx never stores, under the key of a task of a batch, outputs that another group of the batch wrote.

Context: `EVD-NX-24-BATCHES` ("Storing" and "Cargo in one batch") shows that Nx 24.0.6 stores the declared outputs of every task of a batch only when the whole batch has ended, and that a `test` group run after a `build` group in the same batch made Nx store under `a:build`'s key the executable that `cargo test` had built with a dev-dependency's features. `DES-BATCH` runs the groups of a batch one after another, and every inferred target of the `cargo` executor shares one batch. `RISK-BATCH-BEHAVIOUR` records the assumption as refuted. The maintainer decides the change; nothing here chooses one.

Notes: options seen during the spike, none chosen or checked: an executor of its own for the targets whose outputs are cached (`build`, `doc`), so that Nx stores their batch before another starts; or an order of groups in which no group writes declared outputs of a group before it.

Constraint for the design, not a decision: ordering groups inside the executor cannot protect a `build` task that Nx has already taken out of the batch as a cache hit. Nx restores it before the batch starts, and a later `cargo test` in the batch replaces the restored executable on disk, while the cache entry stays right. The same happens without a batch (`EVD-NX-24-BATCHES`, "Cargo in one batch").

- [ ] The maintainer decides how the design avoids it
- [ ] The decision is recorded in Mara (`DES-BATCH`, and `REQ-BATCHING`, `DES-OUTPUTS` or a decision where it changes them), with a check for it in `VER-BATCHING`
- [ ] `pnpm nx format:write`, then `mara schema validate` and `mara project validate` report `valid: true`

Done when: the decided design is accepted in Mara and `mara project validate` reports `valid: true`.
