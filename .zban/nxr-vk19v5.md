---
title: Review the decisions made in 0.6
status: todo
type: task
tags:
  - maintainer
created_at: 2026-11-20T12:37:55Z
---

Goal: the maintainer reads, once, the decisions that the control plane made on his behalf while milestone 0.6 (architecture cleanup and hardening, nxr-e2z8sz) was built, and overturns those he disagrees with. A decision he overturns becomes a new issue. This issue is never dispatched to a worker.

Each line says what was decided, which Mara items it rests on, and how to undo it. "Provisional" marks a decision of a kind the maintainer reserved for himself (anything that cannot be undone, a capability users see) that can still be undone before 1.0 and was therefore taken without stopping the work.

- [ ] Read the list below and overturn what is wrong

## Decisions

1. Every private `nx/src/*` load goes through `nx-rust/src/compatibility/nx-bridge.ts`, which uses the plugin's own peer `nx` only where the repository has no `nx` package at all: a private module missing from the repository's Nx is an error, never a reason to load the peer's, and a resolution error other than a missing module is reported as it is (worker of nxr-gtxq18, accepted at integration). Rests on `REQ-COMPATIBILITY` and `RISK-UPSTREAM-CHANGES`. Undo: fall back to the peer in `resolveFromRepository`.
2. Three differences on failure paths that only a damaged Nx installation reaches were accepted with the bridge: without `matchGlobPaths` the conservative local matcher is used instead of the peer's native one, without `getInputs` one workspace glob is skipped for a deleted path, and a `yargs-parser` without a function fails with the bridge's error instead of a `TypeError` (review of nxr-gtxq18, dropped as exotic by the control plane). Rests on `REQ-COMPATIBILITY` (only an intact, supported Nx counts). Undo: restore each caller's own fallback.
3. The plugin's own specifier lookups (`entries.ts`, `target-defaults.ts`, `plugin-package.ts`) still resolve from the repository root without `.nx/installation`; left to the backlog as nxr-j04frm, since it needs the plugin registered under two specifiers in an `installation` layout (control plane). Rests on `DES-DISCOVERY`. Undo: start nxr-j04frm.
4. Which `cargo metadata` requests wait for one another is judged from manifests alone, without running cargo and without matching `members` or `exclude`: a manifest with a workspace pointer or one that does not parse waits for every request in flight, also where the pointer is in a manifest above one that has no `[workspace]` table (worker of nxr-gp1awx; the ancestor rule decided by the control plane after the review). The set is a superset of what cargo picks, so the only error is an unneeded wait. Rests on `DES-METADATA-REPORT` and `GOAL-TRUSTED-CACHE`. Undo: wait for every request in flight again, in `ComputationReports`.
5. A crate inside `CARGO_HOME` that a workspace around it lists as a member still gets that workspace's report, as before 0.6; left to the backlog as nxr-tbb876 (control plane, exotic). Rests on `DES-METADATA-REPORT`. Undo: start nxr-tbb876.
6. nxr-qkxcmm (the dotenv check) was ordered after nxr-4sr6hd (batch environments without changing `process.env`), because both rework how a batch expands dotenv files and the check depends on how the environment is built (control plane). Rests on `DES-BATCH`. Undo: none needed; an ordering only.
