---
title: Hash the files that fileInputs declares
status: todo
type: feature
parent: nxr-w9qa5f
blocked_by:
  - nxr-fy4t4k
  - nxr-xyq7c8
discovered_from: nxr-qv2cq5
created_at: 2026-11-13T12:05:31Z
---

Goal: the `fileInputs` key in `[package.metadata.nx]` and `[workspace.metadata.nx]` puts the declared files outside a crate into the cache keys of the crate and its dependents.

Implements `REQ-BUILD-SCRIPT-INPUTS` and `REQ-FILE-INPUTS-HASHABLE` through the "Declared files" row and paragraph of `DES-INPUTS` (`nx-rust/docs/caching.mara.md`), the `fileInputs` row of `DES-METADATA-TABLES` and the graph-time row for a bad pattern in `DES-DIAGNOSTICS`. Decision: `ADR-DECLARED-FILE-INPUTS`. Checked by the parts of `VER-CACHE-KEYS` that name declared files.

- [ ] Read `fileInputs` from both tables; the two add up
- [ ] Resolve each pattern against the folder of its manifest and add it to the crate-file input as a fileset with `includeIgnored`
- [ ] Fail graph creation for a pattern that resolves outside the repository (pointing to `runtimeInputs`) or into the workspace's build or artifact directory
- [ ] Add a fixture crate that reads files outside its folder, as `verification.mara.md` lists
- [ ] Cache-key matrix and affected cases for declared files

Done when: the parts of `VER-CACHE-KEYS` that name declared files pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
