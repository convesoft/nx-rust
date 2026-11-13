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

- [ ] Turn the `fileInputs` of both tables, which nxr-xyq7c8 reads as `DES-PLUGIN-OPTIONS` gives them, into filesets as the "Declared files" row and paragraph of `DES-INPUTS` say
- [ ] Put the filesets for `ProjectSettings.fileInputs` into `InputSettings.added.fileInputs` (`inputSettings` in `nx-rust/src/graph/projects.ts`, empty for now; `nx-rust/src/graph/inputs.ts`), which `namedInputs` adds to the crate's named input `default` after its path dependencies, so that its dependents hash them through `^default`
- [ ] The graph-creation error of `REQ-FILE-INPUTS-HASHABLE`, worded as its row in `DES-DIAGNOSTICS`
- [ ] A fixture crate that reads files outside its folder, as "How the plugin is tested" in `verification.mara.md` lists
- [ ] The declared-file cases of `VER-CACHE-KEYS`: keys, affected selection and the ignored and linked files

Done when: the parts of `VER-CACHE-KEYS` that name declared files pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
