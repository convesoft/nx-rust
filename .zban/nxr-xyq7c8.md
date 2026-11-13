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
- [ ] Workspace defaults, with the precedence and the settings that add up as `DES-PLUGIN-OPTIONS` gives them
- [ ] Each setting of `DES-PLUGIN-OPTIONS` read from the places that item gives for it
- [ ] `targets.<name>` merged over the inferred targets as the "Targets" paragraph of `DES-PLUGIN-OPTIONS` says, under the names that `targetNames` gives them (`nameTargets` in `nx-rust/src/graph/targets.ts`), with `check` renamed to `typecheck` as `VER-CONFIGURATION` checks; `continuous` and `readyWhen` on `run` from the crate's table (`DES-TARGET-COMMANDS`)
- [ ] The cases of `VER-TARGETS` that need the tables: `check` and `lint` without `--all-targets` for a crate whose metadata sets `allTargets = false`, and a `run` made continuous with `readyWhen` that starts before a dependent that waits for it. `nx-rust/test/executors.spec.ts` (nxr-kmdpgj) checks the commands with the option set in a `project.json`
- [ ] For `REQ-UNKNOWN-METADATA-OPTIONS`, compare the keys with the `properties` of the executors' schemas (`nx-rust/src/executors/cargo/schema.json` and `run/schema.json`), so that the check and the executors cannot disagree
- [ ] The check of the "Several entries" paragraph of `DES-PLUGIN-OPTIONS`, with plugin isolation on and off (`EVD-NX-24-ENTRY-CONTEXT`)
- [ ] The graph-creation errors that `DES-DIAGNOSTICS` attributes to `DES-PLUGIN-OPTIONS` for the metadata tables and the plugin options; the one for colliding target names belongs to nxr-t1ht7j, and the task-time one for `--affectedTests=true` to nxr-tabkjx
- [ ] Project names from `name` and `namePrefix` as `DES-PROJECT-GRAPH` gives them, and both resolving a collision
- [ ] Plug `envInputs` and `runtimeInputs` of every level, and `featureUnification` and `testRunner` where nxr-k64tm5 and nxr-jb6g5y have not, into the `InputSettings` that `namedInputs` and `configureCaching` take (`nx-rust/src/graph/inputs.ts`, `caching.ts`); they default to none and to `workspace-build` and `cargo` today. The added variables and commands go into the crate's named input `default` ("Added inputs" in `DES-PLUGIN-OPTIONS`), with the `VER-CACHE-KEYS` rows for them, for the crate and its dependents in another workspace
- [ ] Merge the `targets.<name>` tables before the target's `CARGO_TARGET_<TRIPLE>_*` inputs are computed, or compute them again afterwards: `configureCaching` reads the triples from the target's `options` and `configurations` (`configuredTriples` in `caching.ts`), so a `targetTriple` set in metadata must reach it
- [ ] Check that the advice of the warning for a path dependency that Nx cannot see, which names `runtimeInputs` in the crate's `[package.metadata.nx]` (`unseenPathDependencyWarning` in `nx-rust/src/graph/path-dependencies.ts`), works once the table is read
- [ ] The remedies in the collision message (`nx-rust/src/graph/collisions.ts`) offered only where `DES-PLUGIN-OPTIONS` lets the setting apply to that project

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
