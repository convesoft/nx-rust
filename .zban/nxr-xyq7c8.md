---
title: Read overrides from the nx metadata tables
status: todo
type: feature
parent: nxr-w9qa5f
blocked_by:
  - nxr-1bv0wm
created_at: 2026-11-12T18:20:01Z
---

Goal: apply `[package.metadata.nx]` and `[workspace.metadata.nx]` to the inferred projects.

Implements `REQ-METADATA-OVERRIDES` and `DES-METADATA-TABLES` (`nx-rust/docs/configuration.mara.md`). Checked by `VER-CONFIGURATION`. Keys beyond `name`, `tags` and `targets` wait for the option reference (`DES-PLUGIN-OPTIONS`, draft).

- [ ] `name` and `tags` for a crate, read from the metadata report
- [ ] `targets.<name>` overriding an inferred target and defining an extra target
- [ ] Workspace defaults, with the crate's value taking precedence and tags added up
- [ ] The name override and workspace prefix resolve a collision

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm format:check` pass.
