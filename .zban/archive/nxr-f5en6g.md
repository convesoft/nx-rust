---
title: The lockfile task hashes every npm node, so a change to the JS lockfile selects every crate task in nx affected
status: done
type: bug
parent: nxr-w9qa5f
discovered_from: nxr-2ermb0
created_at: 2026-11-13T20:47:02Z
closed_at: 2026-11-13T21:03:10Z
---

Goal: after a commit that changes only the JS lockfile, outside the plugin's package and what it depends on, `nx affected` selects no lockfile task and, through it, no crate task where `VER-CACHE-KEYS` (its end-to-end paragraph) says it selects none.

Found while working on nxr-2ermb0. The lockfile target that `DES-LOCKFILE-HASHING` ("Inputs") describes has no `externalDependencies` input, so Nx gives its hash plan every external node (`EVD-NX-24-EXTERNAL-NODES`, "Every external node by default"). Task-based affected then marks the lockfile task as touched by any change to `pnpm-lock.yaml` (reason `external-dependencies`), and every cached crate task that reads its digest follows (reason `dependent-output`). The crate targets themselves declare the plugin input of `DES-INPUTS` ("Plugin") correctly; the selection comes only through the lockfile task.

Observed with Nx 24.0.6 in `two-workspaces` with a root `package.json`, `pnpmLockfile(...)` and a commit that changes only the integrity of `left-pad`, `nx affected -t test --base=HEAD~1 --head=HEAD --explain=stdout`:

- Rust targets with `externalDependencies: []` (lockfile without the plugin), default `projectsAffectedByDependencyUpdates`: every crate `test` task and both lockfile tasks are selected.
- Same with `"projectsAffectedByDependencyUpdates": "auto"`, for `[]` and for targets that name `@convesoft/nx-rust` alike.
- `tools:lockfile` (workspace in `tools/`) shows only `external-dependencies`; adding `["...", {"externalDependencies": []}]` to the lockfile target through `targetDefaults` removed it and `tools:test`/`scaffold:test` from the selection. The root workspace's lockfile task stays selected for a second reason, filed separately (see related issue).

From the source, not run: the workspace targets `audit`, `deny` and `update` (`nx-rust/src/graph/targets.ts`) have no `externalDependencies` input either, so `nx affected -t audit` would select them after any JS lockfile change.

The cases that show it are in `nx-rust/test/lockfile-runs.spec.ts`, "nx affected after a change to the JS lockfile", on the branch of nxr-2ermb0.

- [x] Decide in Mara which `externalDependencies` input the lockfile target (and the uncached workspace targets) declare, `[]` or the plugin input of `DES-INPUTS`, and update `DES-LOCKFILE-HASHING`
- [x] Declare it, and check through `nx affected` that the lockfile task's hash plan no longer holds every external node
- [x] The JS lockfile cases of nxr-2ermb0 that this cause fails pass, for the workspace outside the repository root

## Summary of Changes

The maintainer decided that every inferred target without the plugin input gets it: `lockfile`, `audit`, `deny` and `update`. Every other inferred target, `fmt`, `bench` and `run` included, already had it. `pluginVersionInput` in `nx-rust/src/graph/inputs.ts` (formerly the private `pluginInput`) gives `externalDependencies` naming `@convesoft/nx-rust` where Nx has an npm node for it, and `[]` otherwise. `lockfileInputs` now ends with it, and `configureCaching` adds it to the inputs `inferTargets` gives `audit`, `deny` and `update`. These targets are not cached, so the input only decides what `nx affected` selects. Recorded in `DES-INPUTS` ("Plugin"), `DES-WORKSPACE-TARGETS` ("Caching"), `DES-LOCKFILE-HASHING` ("Inputs") and a dated bullet in `EVD-NX-24-PLUGIN-VERSION`.

Checks: `nx affected --explain` in a fixture copy no longer reports `external-dependencies` for the lockfile tasks. In `lockfile-runs.spec.ts`, the JS lockfile cases select nothing of the workspace in `tools/` where VER-CACHE-KEYS expects nothing. `caching.spec.ts` checks the input on every target, with and without an npm node; `targets.spec.ts` and `target-defaults.spec.ts` were updated for the added input. `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e --skip-nx-cache`, `mara schema validate`, `mara project validate` and `zban check` pass.
