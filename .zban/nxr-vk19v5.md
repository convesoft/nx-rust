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
7. The plugin keeps telling its `nx.json` entries apart by the copy of its module that Nx makes for each entry, and adds no fallback keyed by workspace root, name or options: nothing else that Nx 24 passes through the public plugin API differs between entries (worker of nxr-hjpc99, accepted at integration). Where a later hook is not called on its entry's copy, or gets an options object other than the one its `createNodes` received (the same object, not an equal one), graph creation fails with a message instead of answering from another entry. A later Nx that passes a fresh copy of the options to each call would fail every graph until supported, which the end-to-end suite would show first. Rests on `DES-DISCOVERY` ("Entries"), `EVD-NX-24-PLUGIN-ENTRIES`, `GOAL-TRUSTED-CACHE` and `REQ-COMPATIBILITY`. Undo: compare options by value, or drop the checks in `Registration.forHook`.
8. A guard against two `createNodes` calls of one entry in one graph computation was removed again after the review (control plane): Nx's daemon can overlap computations, and a delayed plugin worker then made a valid `nx show project` fail. Overlapping computations of one entry answer from the entry's newest call, as before 0.6. Rests on `EVD-NX-24-PLUGIN-ENTRIES` and `DES-DISCOVERY`. Undo: none advised; the guard depended on Nx's scheduling.
9. Three cases stay undetected and are named in `DES-DISCOVERY`: a copy shared by entries with the same options object or without options, an entry's manifests split between calls of one computation, and one copy's later hook called as a method of another entry's copy with the same options. Nx 24 does none of them (control plane, exotic). Undo: none; the public API gives nothing to detect them with.
