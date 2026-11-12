---
title: Check runtime inputs, task-based affected and hashing over cycles in Nx 24
status: todo
type: task
priority: high
tags:
  - spike
parent: nxr-w9qa5f
created_at: 2026-11-12T18:20:01Z
---

Goal: confirm or refute the assumptions in `RISK-NX-INPUT-SEMANTICS` (`nx-rust/docs/decisions.mara.md`). `DES-INPUTS`, `DES-TEST-MODE` and `ADR-ALL-DEP-KINDS` rest on them.

- [ ] A runtime input is evaluated once per run and afresh on the next run, with the Nx daemon on and off
- [ ] The command of a runtime input runs through a shell from the repository root, so that it can change into a workspace folder, and sees the environment of the `nx` command, with the daemon on and off (`ADR-WORKSPACE-ROOT`, `ADR-TEST-MODE-CHOICE`)
- [ ] Task-based affected (the Nx 24 default) treats a changed runtime input and a changed `env` input as the cache does
- [ ] Task-based affected and batched tasks select the same tasks as unbatched ones
- [ ] `^` inputs hash stably, and identically on repeated runs, when two projects depend on each other
- [ ] Record the finding as an evidence item (`EVD-`) in `nx-rust/docs/decisions.mara.md` that supports or contradicts the items above
- [ ] Update the risk (likelihood, consequence, or retire it) and every design or decision the finding changes

Done when: the evidence item is accepted in Mara, and `mara project validate` reports `valid: true`.
