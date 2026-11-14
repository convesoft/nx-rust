---
title: Update RISK-BATCH-BEHAVIOUR with what the input spike established about batches
status: done
type: task
parent: nxr-9y4eh8
related:
  - nxr-3nv4tn
discovered_from: nxr-5p9zq5
created_at: 2026-11-13T10:28:01Z
closed_at: 2026-11-14T15:21:32Z
---

Goal: `RISK-BATCH-BEHAVIOUR` (`nx-rust/docs/decisions.mara.md`) reflects what is already confirmed about batches on Nx 24.0.6.

Context: `EVD-NX-24-INPUT-SEMANTICS` shows, for an executor with `batchImplementation` and `preferBatch: true`, that Nx batched its tasks without `--batch`, hashed each task of the batch on its own with that task's environment, and that batched and unbatched runs restored each other's results task by task. The risk still treats per-task caching from a batch executor as wholly unconfirmed. The batch spike nxr-3nv4tn covers what remains open (a restored task left out of the batch, per-task terminal output, other tasks waiting); this issue can be done there or on its own. Changing the accepted risk needs the maintainer's agreement.

- [x] ~~Propose to the maintainer the updated risk (text, likelihood, consequence), citing the evidence~~ Replaced on 14 November 2026 by the control plane's decision: the risk's text, likelihood and consequence follow the evidence, without asking again
- [x] Apply it
- [x] `pnpm nx format:write`, then `mara schema validate` and `mara project validate` report `valid: true`

Done when: the maintainer has decided, the agreed risk is in place, and `mara project validate` reports `valid: true`.

## Summary of Changes

- Done together with nxr-3nv4tn, in one change. By the control plane's decision of 14 November 2026, recorded in the risk itself, `RISK-BATCH-BEHAVIOUR` follows the evidence without a further proposal to the maintainer.
- `RISK-BATCH-BEHAVIOUR` now cites `EVD-NX-24-INPUT-SEMANTICS` and the new `EVD-NX-24-BATCHES`: per-task results and caching hold on Nx 24.0.6; the waiting is confirmed and stays accepted by `ADR-BATCH-EXECUTOR`; outputs stored only at the end of the batch refute an assumption of `DES-BATCH` (nxr-1q1f0n); results must keep to the shape Nx takes. Likelihood stays `likely`, consequence goes from `moderate` to `major`.
- Checks: `pnpm nx format:write`, `mara schema validate` and `mara project validate` (valid: true, evaluation complete, no errors or warnings), `pnpm nx format:check --all`, `zban check`.
