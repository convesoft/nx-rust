---
title: Implement the hakari and cargo strategies
status: todo
type: feature
parent: nxr-9y4eh8
blocked_by:
  - nxr-8f9dz2
  - nxr-sqyv4b
created_at: 2026-11-12T18:20:01Z
---

Goal: workspaces with cargo-hakari build only the selected crates, and the experimental `cargo` strategy is available as an opt-in.

Implements the `hakari` and `cargo` strategies of `DES-UNIFICATION` (`nx-rust/docs/execution.mara.md`). Checked by `VER-BATCHING`.

- [ ] Choose `hakari` when the workspace has a cargo-hakari configuration
- [ ] Fall back to `workspace-build` when one member enables a feature of another
- [ ] The cached drift check for a stale hack crate
- [ ] The optional strict per-crate build target
- [ ] The `cargo` strategy behind an opt-in, marked experimental
- [ ] Count cargo-hakari as needed in `init`'s table of tools (`nx-rust/src/tools/optional-tools.ts`) where a workspace uses the `hakari` strategy, with the fixture for that row that `VER-SETUP` asks for

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
