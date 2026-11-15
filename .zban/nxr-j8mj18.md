---
title: Give targets whole-workspace cache keys under workspace-build
status: todo
type: feature
parent: nxr-9y4eh8
related:
  - nxr-8f9dz2
created_at: 2026-11-15T15:19:21Z
---

Goal: under the `workspace-build` strategy, the cache key of every crate target covers what a command that selects the whole workspace can read, before any such command exists, so that turning shared commands on (nxr-8f9dz2) never leaves `main` in a state where a cached result depends on something its key does not hold (`GOAL-TRUSTED-CACHE`).

Context: split from nxr-8f9dz2 on 15 November 2026 so that the graph side and the executor side can be done at the same time. This issue is the graph side and lands first; nxr-8f9dz2 is blocked by it. It changes keys only: tasks then run more often than a per-crate command strictly needs, which is allowed, and no cargo command changes here.

- [ ] Under `workspace-build`, give every target of a crate that has its digest the digests of all members and the folders of the path crates outside the workspace that any member reaches ("External dependencies", "Crates outside the workspace" and "Whole-workspace builds" in `DES-INPUTS`), and drop the second half of the status note of `nx-rust/docs/caching.mara.md`; name all those digests in the targets' `metadata.cargo.digests`, so that the post-check compares every digest that the key holds ("Post-check" in `DES-LOCKFILE-HASHING`), with the `VER-CACHE-KEYS` case of a change during the run that moves only a sibling's digest
- [ ] Turn the `VER-CACHE-KEYS` cases that hold under `hakari` only since nxr-ms8zzk into the cases that must differ under `workspace-build` in their fixtures: a locked version bump outside the crate's resolved dependencies, also for the crate at the root of its workspace, a change in a redirected crate for a member without registry or git dependencies, and the end-to-end lockfile case, which then runs every crate of the workspace; and add the new `workspace-build` rows (another member's package, a path crate outside the workspace that only another member reaches)
- [ ] The post-check of a batched task compares every digest that its key now holds, with a real batch (`--batch`), including the change that moves only a sibling's digest (the remaining part of nxr-pht7d6 that needs no shared command; say in nxr-pht7d6 what is then left for it)

Done when: the parts of `VER-CACHE-KEYS` that cover this work pass, and `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all` and `pnpm nx e2e nx-rust-e2e` pass.
