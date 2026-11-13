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

Implements `REQ-METADATA-OVERRIDES`, `DES-METADATA-TABLES` and `DES-PLUGIN-OPTIONS` (`nx-rust/docs/configuration.mara.md`). Checked by `VER-CONFIGURATION`. The cache-key effect of `envInputs` and `runtimeInputs` belongs to nxr-fy4t4k, `artifacts` to the artifact targets, and the opt-out of affected tests to nxr-tabkjx; this issue reads and places them.

- [ ] `name` and `tags` for a crate, read from the metadata report
- [ ] `targets.<name>` overriding an inferred target and defining an extra target
- [ ] Workspace defaults, with precedence defaults, plugin options, workspace table, package table; tags, `implicitDependencies`, `envInputs` and `runtimeInputs` added up
- [ ] The settings of `DES-PLUGIN-OPTIONS` read from the places it gives for each: `namePrefix`, `featureUnification`, `testRunner`, `affectedTests`, `artifacts`, `implicitDependencies`, `envInputs`, `runtimeInputs`, and `targetNames` and `locked` from the plugin options
- [ ] `targets.<name>` merged by Nx's rule with `"..."`; errors for `inputs` without `"..."` and for a different `executor` or a `command` on an inferred target; a repeated inferred executor is accepted
- [ ] The error for entries of the plugin that receive manifests of one workspace and give different values of `testRunner`, `affectedTests` or `featureUnification` that its table does not set, found through the `plugins` of `nx.json` in the context, with plugin isolation on and off (`DES-PLUGIN-OPTIONS`, `EVD-NX-24-ENTRY-CONTEXT`)
- [ ] Errors for unknown top-level keys of both tables, the `project` sub-table and the plugin options, for any `implicitDependencies` entry starting with `!`, and for `affectedTests = true` as a `test` option without the workspace setting
- [ ] The name override and `namePrefix` resolve a collision; the prefix is used as it is and does not apply to a crate with `name` or to the workspace project

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
