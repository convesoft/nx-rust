---
title: Check nx affected after a change to the JS lockfile end to end
status: todo
type: task
parent: nxr-w9qa5f
discovered_from: nxr-fy4t4k
created_at: 2026-11-13T16:03:21Z
---

Goal: the end-to-end part of `VER-CACHE-KEYS` about a change to the JS lockfile passes: which Rust tasks `nx affected` selects, and that they are restored from the cache.

nxr-fy4t4k declared the plugin's input (`externalDependencies` naming the plugin's package where Nx has an npm node for it, `[]` with the option `pluginVersion` otherwise; `pluginInput` in `nx-rust/src/graph/plugin-package.ts`) and checked the keys with Nx's hasher (`nx-rust/test/cache-keys.spec.ts`, "where the Rust targets name the plugin's package"). It also ran the other checks it had first parked here, the missing toolchain and the cache entries and restores of `VER-CARGO-UNCHANGED`, with the executor of nxr-kmdpgj (`nx-rust/test/caching-runs.spec.ts`). What needs commits in a repository with a JS lockfile is left:

- [ ] In a fixture with two workspaces, after a commit that changes only the JS lockfile, outside the plugin's package and what it depends on: `nx affected -t test` selects no Rust task where the Rust targets declare `externalDependencies: []`; where they name the plugin's package, it selects every Rust task under Nx's default `projectsAffectedByDependencyUpdates` of `all`, each restored from the cache, and none with `auto`

Done when: this check passes, and `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all` and `pnpm nx e2e nx-rust-e2e` pass.
