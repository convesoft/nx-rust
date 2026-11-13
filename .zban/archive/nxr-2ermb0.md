---
title: Check nx affected after a change to the JS lockfile end to end
status: done
type: task
parent: nxr-w9qa5f
blocked_by:
  - nxr-f5en6g
  - nxr-5afbsq
discovered_from: nxr-fy4t4k
created_at: 2026-11-13T16:03:21Z
closed_at: 2026-11-13T21:03:31Z
---

Goal: the end-to-end part of `VER-CACHE-KEYS` about a change to the JS lockfile passes: which Rust tasks `nx affected` selects, and that they are restored from the cache.

nxr-fy4t4k declared the plugin's input (`externalDependencies` naming the plugin's package where Nx has an npm node for it, `[]` with the option `pluginVersion` otherwise; `pluginInput` in `nx-rust/src/graph/plugin-package.ts`) and checked the keys with Nx's hasher (`nx-rust/test/cache-keys.spec.ts`, "where the Rust targets name the plugin's package"). It also ran the other checks it had first parked here, the missing toolchain and the cache entries and restores of `VER-CARGO-UNCHANGED`, with the executor of nxr-kmdpgj (`nx-rust/test/caching-runs.spec.ts`). What needs commits in a repository with a JS lockfile is left:

- [x] In a fixture with two workspaces, after a commit that changes only the JS lockfile, outside the plugin's package and what it depends on: `nx affected -t test` selects no Rust task where the Rust targets declare `externalDependencies: []`; where they name the plugin's package, it selects every Rust task under Nx's default `projectsAffectedByDependencyUpdates` of `all`, each restored from the cache, and none with `auto`

Done when: this check passes, and `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all` and `pnpm nx e2e nx-rust-e2e` pass.

## Summary of Changes

The four cases are in `nx-rust/test/lockfile-runs.spec.ts`, "nx affected after a change to the JS lockfile". They use `two-workspaces` with a root `package.json` and `pnpm-lock.yaml`: a workspace at the repository root, and one in `tools/`. A first commit holds the fixture, `nx run-many -t test` fills the cache, and a second commit changes only the integrity of `left-pad`. Each case first checks which `externalDependencies` the Rust targets declare.

- Plugin's package named, Nx's default `all`: every crate `test` task and both lockfile tasks are selected. The crate tasks are restored and the lockfile tasks run.
- `externalDependencies: []` under `all` and under `auto`, and the plugin's package named under `auto`: nothing of `tools/` is selected. For the workspace at the root, exactly its crate `test` tasks (restored) and its lockfile task (run), the accepted limit of nxr-5afbsq.

The first run found two differences from `VER-CACHE-KEYS`. One was fixed in nxr-f5en6g (the lockfile and workspace targets now have the plugin input); the other is the documented limit of nxr-5afbsq. `VER-CACHE-KEYS` now also says that the selected crate tasks are restored while the lockfile tasks among them run, because they are not cached. The git setup that the `Cargo.lock` case had inline is now shared by both groups in that file. Found and filed for later: nxr-q3eqa8, the `doc` key of a workspace project at the repository root changes with the JS lockfile.

Checks: `pnpm nx run-many -t build lint test` (28 suites, 813 tests), `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e --skip-nx-cache` (29 tests), `mara schema validate`, `mara project validate` (valid, complete evaluation) and `zban check` pass.
