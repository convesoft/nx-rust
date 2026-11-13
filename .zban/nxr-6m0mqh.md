---
title: Update RISK-BATCH-BEHAVIOUR with what the input spike established about batches
status: todo
type: task
parent: nxr-9y4eh8
related:
  - nxr-3nv4tn
discovered_from: nxr-5p9zq5
created_at: 2026-11-13T10:28:01Z
---

Goal: `RISK-BATCH-BEHAVIOUR` (`nx-rust/docs/decisions.mara.md`) reflects what is already confirmed about batches on Nx 24.0.6.

Context: `EVD-NX-24-INPUT-SEMANTICS` shows, for an executor with `batchImplementation` and `preferBatch: true`, that Nx batched its tasks without `--batch`, hashed each task of the batch on its own with that task's environment, and that batched and unbatched runs restored each other's results task by task. The risk still treats per-task caching from a batch executor as wholly unconfirmed. The batch spike nxr-3nv4tn covers what remains open (a restored task left out of the batch, per-task terminal output, other tasks waiting); this issue can be done there or on its own. Changing the accepted risk needs the maintainer's agreement.

- [ ] Propose to the maintainer the updated risk (text, likelihood, consequence), citing the evidence
- [ ] After agreement, apply it
- [ ] `pnpm nx format:write`, then `mara schema validate` and `mara project validate` report `valid: true`

Done when: the maintainer has decided, the agreed risk is in place, and `mara project validate` reports `valid: true`.
