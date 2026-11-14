---
title: Implement the hakari and cargo strategies
status: todo
type: feature
parent: nxr-9y4eh8
blocked_by:
  - nxr-8f9dz2
  - nxr-sqyv4b
  - nxr-f92hxm
  - nxr-ms8zzk
created_at: 2026-11-12T18:20:01Z
---

Goal: workspaces with cargo-hakari build only the selected crates, and the experimental `cargo` strategy is available as an opt-in.

Implements the `hakari` and `cargo` strategies of `DES-UNIFICATION` (`nx-rust/docs/execution.mara.md`). Checked by `VER-BATCHING`.

- [ ] Choose `hakari` when the workspace has a cargo-hakari configuration
- [ ] In the check of several entries (the "Several entries" paragraph of `DES-PLUGIN-OPTIONS`; `checkEntries` in `nx-rust/src/graph/entries.ts`), count an entry without `featureUnification` as giving the default that this detection finds, so that it also disagrees with `hakari` or `workspace-build` where that is not the default; until then it disagrees only with `cargo`. Remove that sentence from the status note of `nx-rust/docs/configuration.mara.md`. The setting's value is in `WorkspaceSettings.featureUnification` (`nx-rust/src/graph/settings.ts`), `undefined` for the default
- [ ] Fall back to `workspace-build` when one member enables a feature of another
- [ ] The cached drift check for a stale hack crate
- [ ] The optional strict per-crate build target
- [ ] The `cargo` strategy behind an opt-in, marked experimental
- [ ] Pass each workspace's strategy to the inputs as `InputSettings.featureUnification` (`inputSettings` in `nx-rust/src/graph/projects.ts`, which fixes it to `workspace-build` for now although nxr-xyq7c8 reads the setting): under `hakari` the members' manifests are no inputs of each other's targets ("Member manifests" in `DES-INPUTS`). Until then every workspace counts as `workspace-build`, whose inputs include those of `hakari`; add the `VER-CACHE-KEYS` row that a change to another member's manifest leaves the keys alone under `hakari`, and check by that effect that `featureUnification` in a workspace table wins over the plugin options, as "take a workspace's per-workspace settings from its table…" in `configuration.spec.ts` does for `testRunner` and `affectedTests` (nxr-ma0rq2 dropped the check of the settings record, which had no effect to observe)
- [ ] Count cargo-hakari as needed in `init`'s table of tools (`nx-rust/src/tools/optional-tools.ts`) where a workspace uses the `hakari` strategy, with the fixture for that row that `VER-SETUP` asks for

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
