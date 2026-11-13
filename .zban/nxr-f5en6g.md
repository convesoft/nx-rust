---
title: The lockfile task hashes every npm node, so a change to the JS lockfile selects every crate task in nx affected
status: todo
type: bug
parent: nxr-w9qa5f
discovered_from: nxr-2ermb0
created_at: 2026-11-13T20:47:02Z
---

Goal: after a commit that changes only the JS lockfile, outside the plugin's package and what it depends on, `nx affected` selects no lockfile task and, through it, no crate task where `VER-CACHE-KEYS` (its end-to-end paragraph) says it selects none.

Found while working on nxr-2ermb0. The lockfile target that `DES-LOCKFILE-HASHING` ("Inputs") describes has no `externalDependencies` input, so Nx gives its hash plan every external node (`EVD-NX-24-EXTERNAL-NODES`, "Every external node by default"). Task-based affected then marks the lockfile task as touched by any change to `pnpm-lock.yaml` (reason `external-dependencies`), and every cached crate task that reads its digest follows (reason `dependent-output`). The crate targets themselves declare the plugin input of `DES-INPUTS` ("Plugin") correctly; the selection comes only through the lockfile task.

Observed with Nx 24.0.6 in `two-workspaces` with a root `package.json`, `pnpmLockfile(...)` and a commit that changes only the integrity of `left-pad`, `nx affected -t test --base=HEAD~1 --head=HEAD --explain=stdout`:

- Rust targets with `externalDependencies: []` (lockfile without the plugin), default `projectsAffectedByDependencyUpdates`: every crate `test` task and both lockfile tasks are selected.
- Same with `"projectsAffectedByDependencyUpdates": "auto"`, for `[]` and for targets that name `@convesoft/nx-rust` alike.
- `tools:lockfile` (workspace in `tools/`) shows only `external-dependencies`; adding `["...", {"externalDependencies": []}]` to the lockfile target through `targetDefaults` removed it and `tools:test`/`scaffold:test` from the selection. The root workspace's lockfile task stays selected for a second reason, filed separately (see related issue).

From the source, not run: the workspace targets `audit`, `deny` and `update` (`nx-rust/src/graph/targets.ts`) have no `externalDependencies` input either, so `nx affected -t audit` would select them after any JS lockfile change.

The cases that show it are in `nx-rust/test/lockfile-runs.spec.ts`, "nx affected after a change to the JS lockfile", on the branch of nxr-2ermb0.

- [ ] Decide in Mara which `externalDependencies` input the lockfile target (and the uncached workspace targets) declare, `[]` or the plugin input of `DES-INPUTS`, and update `DES-LOCKFILE-HASHING`
- [ ] Declare it, and check with Nx's hasher that the lockfile task's plan no longer holds every external node
- [ ] The JS lockfile cases of nxr-2ermb0 that this cause fails pass, for the workspace outside the repository root
