---
title: Check runtime inputs, task-based affected and hashing over cycles in Nx 24
status: in-progress
type: task
priority: high
tags:
  - spike
parent: nxr-w9qa5f
created_at: 2026-11-12T18:20:01Z
---

Goal: confirm or refute the assumptions in `RISK-NX-INPUT-SEMANTICS` (`nx-rust/docs/decisions.mara.md`). `DES-INPUTS`, `DES-TEST-MODE` and `ADR-ALL-DEP-KINDS` rest on them.

- [x] A runtime input is evaluated once per run and afresh on the next run, with the Nx daemon on and off
- [x] The command of a runtime input runs through a shell from the repository root, so that it can change into a workspace folder, and sees the environment of the `nx` command, with the daemon on and off (`ADR-WORKSPACE-ROOT`, `ADR-TEST-MODE-CHOICE`)
- [x] Task-based affected (the Nx 24 default) treats a changed runtime input and a changed `env` input as the cache does
- [x] Task-based affected and batched tasks select the same tasks as unbatched ones
- [x] `^` inputs hash stably, and identically on repeated runs, when two projects depend on each other
- [x] Record the finding as an evidence item (`EVD-`) in `nx-rust/docs/decisions.mara.md` that supports or contradicts the items above
- [ ] Update the risk (likelihood, consequence, or retire it) and every design or decision the finding changes

Done when: the evidence item is accepted in Mara, and `mara project validate` reports `valid: true`.

## Notes

- Recorded as `EVD-NX-24-INPUT-SEMANTICS`; `RISK-NX-INPUT-SEMANTICS` is updated (likelihood `unlikely`, consequence `major`, now also threatening `REQ-ENV-ALLOWLIST`). The closing sentences of `ADR-ALL-DEP-KINDS` and `ADR-WORKSPACE-ROOT`, which said the check was still open, now cite the evidence.
- The finding contradicts `DES-TEST-MODE` and `DES-BATCH` in one case: in a batch, a variable from a per-task dotenv file is in the key but not in the batch process. Changes to `DES-TEST-MODE`, `DES-BATCH` and `VER-BATCHING`, and a clarification of `ADR-DECLARED-INPUTS`, are proposed to the maintainer and not made. The last task item stays open until the maintainer has decided.
- Throwaway workspace and logs used for the experiments were outside the repository and are not kept; the evidence item names versions, layout and commands.
