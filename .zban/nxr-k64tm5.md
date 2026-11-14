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

- [ ] Choose `hakari` where the workspace has a cargo-hakari configuration whose `hakari-package` names a member and passes the four graph-time checks of "When the hack crate is enough" in `DES-UNIFICATION`, the fourth being the settings of the configuration that it accepts; the first counts `default-features = false` on a member that declares `default`, also `default = []`, and a member's dev-dependency on itself with features, and the second requires the host only, while a non-host triple that `platforms` misses keeps `hakari`, warns and runs per crate ("Triples that `platforms` does not list"); record its `platforms` in the projects' metadata
- [ ] In the check of several entries (the "Several entries" paragraph of `DES-PLUGIN-OPTIONS`; `checkEntries` in `nx-rust/src/graph/entries.ts`), count an entry without `featureUnification` as giving the default that this detection finds, so that it also disagrees with `hakari` or `workspace-build` where that is not the default; until then it disagrees only with `cargo`. Remove that sentence from the status note of `nx-rust/docs/configuration.mara.md`. The setting's value is in `WorkspaceSettings.featureUnification` (`nx-rust/src/graph/settings.ts`), `undefined` for the default
- [ ] Otherwise fall back to `workspace-build`, also where `featureUnification` sets `hakari`, with the warning of "Fallback" in `DES-UNIFICATION` as a project warning of every project of the workspace (`DES-DIAGNOSTICS`, "Warnings where they are seen")
- [ ] The uncached `hakari-check` target of "Drift" in `DES-UNIFICATION` and `DES-WORKSPACE-TARGETS`, run by the lockfile executor and depending on the lockfile task, with the dependency on it of the crates' cached targets and `doc`, the failure before cargo runs of a crate task without it, and its name among the keys of `targetNames`
- [ ] Groups of one crate ("Groups of one crate" in `DES-BATCH`): under `hakari` for a feature set given by flags and for a triple or host that the recorded `platforms` does not list ("Feature flags" and "Triples when a task starts" in `DES-UNIFICATION`), and under `cargo` for `--features`
- [ ] The optional strict per-crate build target
- [ ] The `cargo` strategy behind an opt-in, marked experimental, passing `--config 'resolver.feature-unification="workspace"'` and `-Zfeature-unification` on the command line of every step ("How each strategy selects" in `DES-UNIFICATION`), with the `cargo` case of `VER-BATCHING` on a stable toolchain
- [ ] Pass each workspace's strategy to the inputs as `InputSettings.featureUnification` (`inputSettings` in `nx-rust/src/graph/projects.ts`, which fixes it to `workspace-build` for now although nxr-xyq7c8 reads the setting): under `hakari` the members' manifests are no inputs of each other's targets ("Member manifests" in `DES-INPUTS`), a crate's key holds its own digest only ("External dependencies"), and the hack crate's manifest and the configuration file of cargo-hakari are added ("Hack crate"); under `cargo`, the inputs of `workspace-build` that nxr-8f9dz2 adds. Until then every workspace counts as `workspace-build`; add the `VER-CACHE-KEYS` row that a change to another member's manifest leaves the keys alone under `hakari`, and check by that effect that `featureUnification` in a workspace table wins over the plugin options, as "take a workspace's per-workspace settings from its table…" in `configuration.spec.ts` does for `testRunner` and `affectedTests` (nxr-ma0rq2 dropped the check of the settings record, which had no effect to observe)
- [ ] Count cargo-hakari as needed in `init`'s table of tools (`nx-rust/src/tools/optional-tools.ts`) where a workspace uses the `hakari` strategy, with the fixture for that row that `VER-SETUP` asks for
- [ ] In a `hakari` fixture, the `VER-CACHE-KEYS` cases that hold under `hakari` only since nxr-ms8zzk: a locked version bump outside the crate's resolved dependencies, also for the crate at the root of its workspace, a change in a redirected crate for a member without registry or git dependencies, and the end-to-end lockfile case that restores the crates whose digest stayed the same
- [ ] The `hakari` cases of `VER-BATCHING`
- [ ] Under `hakari`, the post-check of a task that shared its command compares every member's digest, and that of a task in a group of one crate its own ("Post-check" in `DES-LOCKFILE-HASHING`), with the `hakari` case of `VER-CACHE-KEYS`

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
