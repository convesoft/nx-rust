---
title: Hash external dependencies per crate
status: todo
type: feature
parent: nxr-w9qa5f
blocked_by:
  - nxr-pn1hwr
  - nxr-fy4t4k
created_at: 2026-11-12T18:20:01Z
---

Goal: a lockfile change invalidates only the crates whose resolved dependencies it changes.

Implements `REQ-EXTERNAL-DEPS` through the accepted form of `DES-LOCKFILE-HASHING` (`nx-rust/docs/workspaces.mara.md`). Checked by `VER-CACHE-KEYS`.

- [ ] Create the external nodes, with the identity that `DES-LOCKFILE-HASHING` specifies, from `Cargo.lock`
- [ ] Replace the whole-lockfile input of crate targets with the per-crate mechanism
- [ ] Matrix rows: a bump inside a crate's resolved dependencies changes its keys; a bump outside does not

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm format:check` pass.
