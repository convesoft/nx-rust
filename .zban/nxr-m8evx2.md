---
title: Implement Nx release for crates
status: todo
type: feature
parent: nxr-6q2chq
blocked_by:
  - nxr-5fp9d3
created_at: 2026-11-12T18:20:01Z
---

Goal: `nx release version` and `nx release publish` work for crates.

Implements the accepted form of `REQ-RELEASE` and `DES-RELEASE` (`nx-rust/docs/release.mara.md`), written by the specification issue that blocks this one. Checked by the verification that issue adds.

- [ ] The `VersionActions` implementation for `Cargo.toml`
- [ ] Dependents and `Cargo.lock` after a bump
- [ ] The publish target, in dependency order, absent for `publish = false`
- [ ] The hack-crate dependency for workspaces with cargo-hakari

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm format:check` pass.
