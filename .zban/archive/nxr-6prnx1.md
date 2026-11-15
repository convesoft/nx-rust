---
title: A dependsOn that a crate declares on a project that a project.json renames makes the target-default guard unable to tell who changed the target
status: done
type: bug
priority: low
parent: nxr-9y4eh8
discovered_from: nxr-gyyhdj
created_at: 2026-11-15T08:58:40Z
closed_at: 2026-11-15T10:00:39Z
---

Goal: `DES-TARGET-DEFAULT-GUARD` attributes a change to a target whose declared `dependsOn` names a project by a name that Nx changes while it merges the graph, and reports an entry that replaces that target's `inputs` as the error it is.

Context: found while fixing nxr-gyyhdj. Nx 24.0.6 replaces the project names in `dependsOn` and `inputs` with placeholders after each plugin's batch and writes the final name of each placeholder's project back after the merge (`project-graph/utils/project-configuration/name-substitution-manager.js`, `EVD-NX-24-PLUGIN-NODES`). In a copy of `subfolder-workspace` where `api`'s `Cargo.toml` declares `[package.metadata.nx.targets.check] dependsOn = ["...", { projects = ["model"], target = "check" }]` and `rust/crates/model/project.json` is `{ "name": "model-rs" }`, the merged `check` of `api` depends on `model-rs` while the plugin declared `model`. The guard's rebuild applies no such substitution, so it does not reproduce the merged target: with `targetDefaults: { check: { options: { quiet: true } } }` graph creation succeeds with the warning that nx-rust cannot tell which configuration changed `api:check` in "dependsOn", and with `check: { inputs: ["default"] }` the replaced inputs of `api:check` get that warning instead of the error (the other crates still get the error). This holds with the plugin in a worker, Nx's default, and, since nxr-gyyhdj gave Nx a copy of the plugin's nodes, also in Nx's own process, where Nx used to write the final name into the plugin's own record by accident. A sound fix must map a declared name only where Nx's substitution provably gives the merged name, as for a name that one of the plugin's own projects had when its batch was merged; anything less certain stays a difference.

- [x] Reproduce both cases with the real Nx, in both plugin modes
- [x] Compare and rebuild with the names that Nx's substitution gives where that is certain, or record the limit in `DES-TARGET-DEFAULT-GUARD`
- [x] Tests in `target-defaults.spec.ts` for both cases and for a name that must stay a difference

Done when: the replaced inputs above are reported as an error naming the entry, the `options` entry draws no warning, or the limit is recorded in Mara, and the checks pass.

## Summary of Changes

Brought into the branch of nxr-gyyhdj after its review, which found by running that, with the copy of the plugin's nodes, an entry narrowed by a `filter` to one crate whose declared `dependsOn` names a renamed crate replaced that crate's `inputs`, `outputs` or `dependsOn` with only the attribution warning. In plugin workers the same was already the case on `main`.

Change (`nx-rust/src/graph/target-defaults.ts`):
- `nxNames` gives the project references in the `dependsOn` and `inputs` that the plugin declares the names that Nx gives them, where that is certain. A name that the plugin gave one of its entry's projects becomes the merged name of the project at that root. Only the forms that Nx 24.0.6 renames are touched: a `projects` string other than `*`, `self` and `dependencies` (`self` and `dependencies` in `inputs`), a non-glob element of a `projects` list, and a `<project>:<target>` string with one colon that Nx can read no other way. Every other name stays as written. The renaming applies to the inferred target and to the plugin's layer of the rebuild.
- Each of `cache`, `inputs`, `outputs` and `dependsOn` is judged on its own (`reproducedFields`). Where the rebuild does not give a field, or the project's name and tags, a lost entry that the rebuild without `targetDefaults` keeps is still an error. It is reported against the entry if an element that Nx's synthesis lays over the target replaces that field (`replacedFields`). The synthesis is read with the merged project's name and tags. Only other differences draw the attribution warning; caching turned on stays attributed only where the rebuild gives it.

Knowledge: `DES-TARGET-DEFAULT-GUARD` ("Which layer") rewritten, saying why (the review's cases); `EVD-NX-24-PLUGIN-NODES` gained which references Nx renames, which project a name resolves to, and the runs; `VER-TARGET-DEFAULT-GUARD` gained the cases. No message changed.

Tests (`target-defaults.spec.ts`, real Nx, each in Nx's own process and in a plugin worker):
- The review's four cases are errors that name the entry: the replaced inputs with the dependency as a projects list, as `model:check` and as a `projects` string; `dependsOn: []` where the declared inputs name `model`; and, in `binary-tests`, `outputs: []` on `app:build`, which depends on the renamed `library:check`.
- An options-only entry draws nothing for each form, and the merged dependency names `model-rs`.
- A reference to `web`, which `package.json` names and `project.json` renames `web-app`, stays a difference: it draws the warning with an options-only entry, and an entry whose replacing inputs name `web` is an error.
- An entry filtered to a tag that another plugin gives `api` and that replaces its inputs is an error.

Before the change, 20 of these 22 tests failed; the two that passed are the expected warnings.

Checks run on the final head (local `main` merged, nothing new): `NX_DAEMON=false pnpm nx run-many -t build lint test --skip-nx-cache` (45 suites, 1467 tests passed, 1 todo), `NX_DAEMON=false pnpm nx e2e nx-rust-e2e --skip-nx-cache` (27 passed), `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` (`valid: true`, evaluation complete, no diagnostics) and `zban check`.

## Later in this branch

The second review found two more ways for an entry to reach a stale cache hit. Both are also on `main`: the same tests fail there, and in the second case `nx run api:check` ran cargo and succeeded with caching on.

1. **`filter.plugin`.** Nx compares it with the plugin that first gave the target its executor, which graph creation cannot see. The guard now also runs Nx's synthesis with every other plugin that may be that source (`otherSourcePlugins`). It does so whenever `nx.json` lists another plugin: for each `filter.plugin` it names, and for one that none names.
2. **`cache = false` in a target table.** It was not among the reasons the executor reads. `applyTargetTables` now records it in `metadata.cargo.uncached`, naming the table and the manifest, so the executor fails any task that caches such a target. I chose this over making the warning an error because it is exact: it also covers a crate's own `project.json` turning caching on, which the guard leaves to the executor.

In both cases, where the rebuild does not reproduce a field, the change is an error against every entry with an element that may apply and would make it (`explainingElements`). This covers caching turned on as well as lost lists. The remaining `cache` warning is backed by the executor. Tag filters are read with the merged tags, which are the ones Nx's synthesis reads.

Knowledge: updated `DES-TARGET-DEFAULT-GUARD` ("What counts" and "Which layer", with the review's cases), the "Per project" paragraph of `DES-OUTPUTS`, the user guide's caching sentence, `VER-TARGET-DEFAULT-GUARD` and `EVD-NX-24-PLUGIN-NODES` ("Source of a target").

Tests (real Nx): the two reproductions as errors in both modes. A residual case, where another plugin caches `check` and no entry applies, warns, and `nx run api:check` fails before cargo runs twice in a row, in both modes. Three near misses draw nothing: a `filter.plugin` entry whose `filter.executor` leaves `check` out, one that keeps the inputs with `"..."`, and `cache: true` before an object-level `"..."`. Two existing tag cases became errors that name the entry.

Checks on the final head eea700a, which contains local `main` at acb7504:
- `NX_DAEMON=false pnpm nx run-many -t build lint test --skip-nx-cache`: 45 suites, 1473 passed, 1 todo
- `NX_DAEMON=false pnpm nx e2e nx-rust-e2e --skip-nx-cache`: 27 passed
- `pnpm nx format:check --all`
- `mara schema validate`
- `mara project validate`: `valid: true`, evaluation complete, no diagnostics
- `zban check`
