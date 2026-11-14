---
title: Decide how a batch keeps a later group from changing the outputs that Nx stores for an earlier task
status: done
type: task
priority: high
tags:
  - spec
parent: nxr-9y4eh8
discovered_from: nxr-3nv4tn
created_at: 2026-11-14T15:19:05Z
closed_at: 2026-11-14T17:55:35Z
---

Goal: `DES-BATCH` keeps `GOAL-TRUSTED-CACHE` on Nx 24: Nx never stores, under the key of a task of a batch, outputs that another group of the batch wrote.

Context: `EVD-NX-24-BATCHES` ("Storing" and "Cargo in one batch") shows that Nx 24.0.6 stores the declared outputs of every task of a batch only when the whole batch has ended, and that a `test` group run after a `build` group in the same batch made Nx store under `a:build`'s key the executable that `cargo test` had built with a dev-dependency's features. `DES-BATCH` runs the groups of a batch one after another, and every inferred target of the `cargo` executor shares one batch. `RISK-BATCH-BEHAVIOUR` records the assumption as refuted. The maintainer decides the change; nothing here chooses one.

Notes: options seen during the spike, none chosen or checked: an executor of its own for the targets whose outputs are cached (`build`, `doc`), so that Nx stores their batch before another starts; or an order of groups in which no group writes declared outputs of a group before it.

Constraint for the design, not a decision: ordering groups inside the executor cannot protect a `build` task that Nx has already taken out of the batch as a cache hit. Nx restores it before the batch starts, and a later `cargo test` in the batch replaces the restored executable on disk, while the cache entry stays right. The same happens without a batch (`EVD-NX-24-BATCHES`, "Cargo in one batch").

- [x] The maintainer decides how the design avoids it
- [x] The decision is recorded in Mara (`DES-BATCH`, and `REQ-BATCHING`, `DES-OUTPUTS` or a decision where it changes them), with a check for it in `VER-BATCHING`
- [x] `pnpm nx format:write`, then `mara schema validate` and `mara project validate` report `valid: true`

Done when: the decided design is accepted in Mara and `mara project validate` reports `valid: true`.

## Summary of Changes

- The maintainer chose on 14 November 2026 "`test` waits for own `build` (Recommended)"; recorded word for word in `ADR-TEST-AFTER-BUILD`, with the options he did not take (plugin lock and own copy, a build directory of its own for tests, not caching those builds) and why they lost. The fix on `main` went in with nxr-621hvq on the same branch.
- 0.2 design: `DES-BATCH` ("Two batch executors") runs `build` and `doc` through `@convesoft/nx-rust:cargo-outputs`, so that Nx stores their batch before a batch that waits for it starts; it says what that means for `targetDefaults` keyed by executor, for `init`, for groups inside each batch and for a `build` restored before a `test` batch. `REQ-BATCHING` gains a sentence, `VER-BATCHING` a check, `ADR-BATCH-EXECUTOR` and `RISK-BATCH-BEHAVIOUR` the answer; `DES-TARGETS` names the executor. nxr-s12cpg's task list has the work; closing this issue removes its blocker.
- `RISK-ARTIFACT-DIR-WRITERS` (possible, major) records what remains; `EVD-CARGO-ARTIFACT-WRITERS` keeps the research's numbers apart from the measurements of nxr-621hvq.
- Checks: `pnpm nx format:write`, `mara schema validate` and `mara project validate` (`valid: true`, evaluation complete, no errors or warnings), `zban check`, with the full checks of nxr-621hvq on the same head.
