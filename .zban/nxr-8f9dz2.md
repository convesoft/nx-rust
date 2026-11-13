---
title: Implement feature sets and the workspace-build strategy
status: todo
type: feature
parent: nxr-9y4eh8
blocked_by:
  - nxr-s12cpg
created_at: 2026-11-12T18:20:01Z
---

Goal: features are resolved for the whole workspace on every run, with the fallback strategy that always works.

Implements `REQ-STABLE-FEATURES`, `DES-FEATURE-SETS` and the `workspace-build` strategy of `DES-UNIFICATION` (`nx-rust/docs/execution.mara.md`). Checked by `VER-BATCHING`.

- [ ] The default and all-features configurations at workspace level
- [ ] `crate/feature` and crates that form their own group
- [ ] `workspace-build`: build the whole workspace, filter which tests run
- [ ] A non-host triple as its own group that builds only the selected crates

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm format:check` pass.
