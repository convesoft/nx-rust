---
title: Read overrides from the nx metadata tables
status: done
type: feature
parent: nxr-w9qa5f
blocked_by:
  - nxr-1bv0wm
created_at: 2026-11-12T18:20:01Z
closed_at: 2026-11-13T16:25:38Z
---

Goal: apply `[package.metadata.nx]` and `[workspace.metadata.nx]` to the inferred projects.

Implements `REQ-METADATA-OVERRIDES`, `DES-METADATA-TABLES` and `DES-PLUGIN-OPTIONS` (`nx-rust/docs/configuration.mara.md`). Checked by `VER-CONFIGURATION`. The cache-key effect of `envInputs` and `runtimeInputs` belongs to nxr-fy4t4k, `artifacts` to the artifact targets, and the opt-out of affected tests to nxr-tabkjx; this issue reads and places them.

- [x] `name` and `tags` for a crate, read from the metadata report
- [x] `targets.<name>` overriding an inferred target and defining an extra target
- [x] Workspace defaults, with the precedence and the settings that add up as `DES-PLUGIN-OPTIONS` gives them
- [x] Each setting of `DES-PLUGIN-OPTIONS` read from the places that item gives for it
- [x] `targets.<name>` merged over the inferred targets as the "Targets" paragraph of `DES-PLUGIN-OPTIONS` says, under the names that `targetNames` gives them (`nameTargets` in `nx-rust/src/graph/targets.ts`), with `check` renamed to `typecheck` as `VER-CONFIGURATION` checks; `continuous` and `readyWhen` on `run` from the crate's table (`DES-TARGET-COMMANDS`)
- [x] The cases of `VER-TARGETS` that need the tables: `check` and `lint` without `--all-targets` for a crate whose metadata sets `allTargets = false`, and a `run` made continuous with `readyWhen` that starts before a dependent that waits for it. `nx-rust/test/executors.spec.ts` (nxr-kmdpgj) checks the commands with the option set in a `project.json`
- [x] The check of the "Several entries" paragraph of `DES-PLUGIN-OPTIONS`, with plugin isolation on and off (`EVD-NX-24-ENTRY-CONTEXT`)
- [x] The graph-creation errors that `DES-DIAGNOSTICS` attributes to `DES-PLUGIN-OPTIONS` for the metadata tables and the plugin options; the one for colliding target names belongs to nxr-t1ht7j, and the task-time one for `--affectedTests=true` to nxr-tabkjx
- [x] Project names from `name` and `namePrefix` as `DES-PROJECT-GRAPH` gives them, and both resolving a collision
- [x] The remedies in the collision message (`nx-rust/src/graph/collisions.ts`) offered only where `DES-PLUGIN-OPTIONS` lets the setting apply to that project

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Summary of Changes

- Reading (`nx-rust/src/graph/settings.ts`): `readPluginOptions` reads every plugin option of `DES-PLUGIN-OPTIONS`; `targetNames` and `locked` keep their own readers and messages in `options.ts`. `readSettings` reads `[workspace.metadata.nx]` with its `project` table and each handed member's `[package.metadata.nx]` from the `cargo metadata` reports, validates each key and value, and combines them by the precedence of `DES-PLUGIN-OPTIONS` (crate over workspace over plugin options; tags, `implicitDependencies`, `fileInputs`, `envInputs` and `runtimeInputs` add up). The result is one typed place, `CargoProject.settings` (`ProjectSettings` with its `WorkspaceSettings`), from which the other issues read: `envInputs` and `runtimeInputs` for nxr-fy4t4k, `fileInputs` with the manifest each pattern is relative to for nxr-d371vy, `testRunner`, `affectedTests` and `featureUnification` for milestones 0.2 and 0.3, `artifacts` for 0.4. Unknown keys, a key valid only elsewhere (with a hint where it belongs, and a case-insensitive "did you mean"), invalid values, `implicitDependencies` entries starting with `!` and a `[workspace.metadata.nx.project]` table in a root manifest that defines a crate fail graph creation, all problems in one message, each naming the file and the key.
- In the graph: names with `name` and `namePrefix` (`graph/names.ts`), the workspace project's `name` from its table, tags and `implicitDependencies` on the returned projects (`graph/projects.ts`). `targets.<name>` tables (`graph/target-tables.ts`) are laid over the inferred targets after `targetNames`, workspace table first, with Nx's own `mergeTargetConfigurations` (loaded from the installed Nx's `nx/src/devkit-internals`, `graph/nx-internals.ts`); other names define extra targets. `tableProblems` is the one place that checks a table before merging: `inputs` without `"..."`, a different `executor` or a `command` on an inferred target, and `affectedTests = true` in the options or a configuration of `test` without the workspace setting. The same `affectedTests` check runs in `createDependencies` on what Nx merged from `targetDefaults`, `project.json` and `package.json`.
- Several entries (`graph/entries.ts`): each entry finds the plugin's entries in the `plugins` of `nx.json`, applies their `include` and `exclude` with Nx's `findMatchingConfigFiles` to `globWithWorkspaceContext`, and fails graph creation where entries that receive manifests of one workspace give different `testRunner`, `affectedTests` or `featureUnification` that the workspace table does not set, naming the workspace, the setting and the entries as `plugins[i]`. Until nxr-k64tm5 detects cargo-hakari configurations, an entry without `featureUnification` disagrees only with `cargo`; nxr-k64tm5 has the step, and the status note says so.
- Collisions: project metadata carries `nameOverride: true` where the crate's own `name` gave the name, and the message offers `namePrefix` only for a crate without one (`DES-PROJECT-GRAPH` updated).
- Mara: status notes of the Configuration and Workspaces pages; `DES-PLUGIN-OPTIONS` names Nx's functions used for the merge and the entries check; `RISK-UPSTREAM-CHANGES` lists the functions taken from `nx/src/devkit-internals`. The schema-comparison step for `REQ-UNKNOWN-METADATA-OPTIONS` moved to nxr-95kg91, which now names `tableProblems` as its place.

Checks run on the merge with `origin/main` at e14459a: `nx-rust/test/configuration.spec.ts` (55 tests: names, tags, implicit dependencies, options and extra targets of both tables and the project table; a target renamed to `typecheck` overridden by its new name; `"..."` keeping the inferred inputs of `audit`, `update` and `test` with the inferred executor repeated; `continuous` and `readyWhen` on `run`; `namePrefix` for members, a root crate, a standalone crate and not for a crate with a `name` or the workspace project; the name from a `package.json` with the tags of both; collision remedies and resolution by name, prefix and project-table name; each graph-creation error; `affectedTests` from `targetDefaults`; placement of every setting at each level; the several-entries check with isolation on, off and through the daemon, and the passing cases; with the real executor, `typecheck` and `lint` without `--all-targets` from a crate's table, a continuous `run` that a `waitFor: "ready"` dependent waits for, an extra `command` target, and a table repeating the cargo executor on a crate without that target failing at task start), three new `init` cases in `init.spec.ts`, and two end-to-end cases through the installed package. `pnpm nx run-many -t build lint test` (16 suites, 457 tests passed), `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e` (19 tests passed), `mara schema validate`, `mara project validate` (valid, evaluation complete, 0 errors, 0 warnings), `mara related` for each linked item, `zban check`.

Filed: nxr-mnv7sb (what a workspace table's `targets.<name>` does on members without that inferred target; options and a recommendation for the maintainer).
