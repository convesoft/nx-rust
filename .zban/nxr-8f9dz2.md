---
title: Implement feature sets and the workspace-build strategy
status: todo
type: feature
parent: nxr-9y4eh8
blocked_by:
  - nxr-s12cpg
  - nxr-ms8zzk
  - nxr-ypa0aw
created_at: 2026-11-12T18:20:01Z
---

Goal: features are resolved for the whole workspace on every run, with the fallback strategy that always works.

Implements `REQ-STABLE-FEATURES`, `DES-FEATURE-SETS` and the `workspace-build` strategy of `DES-UNIFICATION` (`nx-rust/docs/execution.mara.md`). Checked by `VER-BATCHING`.

- [ ] The default and all-features configurations at workspace level
- [ ] `crate/feature` and crates that form their own group
- [ ] `workspace-build`: build the whole workspace, filter which tests run
- [ ] A non-host triple as its own group, with one cargo command per crate ("Groups of one crate" in `DES-BATCH`, `DES-FEATURE-SETS`), and the `workspace-build` case of "Triples" in `VER-BATCHING`
- [ ] Under `workspace-build`, give every target of a crate that has its digest the digests of all members and the folders of the path crates outside the workspace that any member reaches ("External dependencies", "Crates outside the workspace" and "Whole-workspace builds" in `DES-INPUTS`), and drop the second half of the status note of `nx-rust/docs/caching.mara.md`; name all those digests in the targets' `metadata.cargo.digests`, so that the post-check compares every digest that the key holds ("Post-check" in `DES-LOCKFILE-HASHING`), with the `VER-CACHE-KEYS` case of a change during the run that moves only a sibling's digest
- [ ] Turn the `VER-CACHE-KEYS` cases that hold under `hakari` only since nxr-ms8zzk into the cases that must differ under `workspace-build` in their fixtures: a locked version bump outside the crate's resolved dependencies, also for the crate at the root of its workspace, a change in a redirected crate for a member without registry or git dependencies, and the end-to-end lockfile case, which then runs every crate of the workspace; and add the new `workspace-build` rows (another member's package, a path crate outside the workspace that only another member reaches)

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
