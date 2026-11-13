---
title: Check the end-to-end rows of the cache keys and outputs once tasks run
status: todo
type: task
parent: nxr-w9qa5f
blocked_by:
  - nxr-kmdpgj
discovered_from: nxr-fy4t4k
created_at: 2026-11-13T16:03:21Z
---

Goal: the parts of `VER-CACHE-KEYS` and `VER-CARGO-UNCHANGED` about inputs and outputs that need a task to run, and so the plugin's executor, pass end to end.

nxr-fy4t4k declared the inputs and outputs and checked them with Nx's hasher and graph (`nx-rust/test/cache-keys.spec.ts`, `caching.spec.ts`), without an executor. What runs a task is left:

- [ ] `VER-CACHE-KEYS`: with the toolchain that a workspace pins missing after the graph was created, a cached task of that workspace runs, and a second run does not restore the first run's result
- [ ] `VER-CACHE-KEYS`, end to end in a fixture with two workspaces: after a commit that changes only the JS lockfile, outside the plugin's package and what it depends on, `nx affected -t test` selects no Rust task where the Rust targets declare `externalDependencies: []`; where they name the plugin's package, it selects every Rust task under Nx's default `projectsAffectedByDependencyUpdates` of `all`, each restored from the cache, and none with `auto`
- [ ] `VER-CARGO-UNCHANGED`: with the build directory configured outside the repository, the Nx cache entry of each task contains no file from it, and a `build` entry contains only the named final artifacts; deleting the artifact and restoring `build` from the cache puts it back and leaves the modification times in the build directory unchanged; the `build` entry of a `cdylib` or `staticlib` crate holds the library file and no entry holds an `rlib`; a `doc` cache hit restores the workspace's whole `doc` folder

Done when: these checks pass, and `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all` and `pnpm nx e2e nx-rust-e2e` pass.
