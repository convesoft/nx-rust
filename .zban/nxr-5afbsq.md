---
title: Nx counts the JS lockfile as configuration of a Cargo workspace project at the repository root, so nx affected selects its lockfile task and crates
status: todo
type: bug
parent: nxr-w9qa5f
related:
  - nxr-f5en6g
discovered_from: nxr-2ermb0
created_at: 2026-11-13T20:47:15Z
---

Goal: `nx affected` behaves as the end-to-end paragraph of `VER-CACHE-KEYS` says after a commit that changes only the JS lockfile also where a Cargo workspace lies at the repository root, or Mara records why it cannot and what the repository then sees.

Found while working on nxr-2ermb0. In `two-workspaces` the virtual workspace at the repository root has its workspace project `cargo-workspace` at root `.` (`TERM-WORKSPACE-PROJECT`, `DES-WORKSPACE-TARGETS`), which owns the lockfile task (`DES-LOCKFILE-HASHING`). `pnpm-lock.yaml` matches the `createNodes` pattern of Nx's own `nx/js/dependencies-and-lockfile` plugin and lies in that project's folder, so Nx 24.0.6 counts it as a configuration file of `cargo-workspace`, which every hash plan of the project's tasks holds. `nx affected -t test --base=HEAD~1 --head=HEAD --explain=stdout`, after a commit that changes only the integrity of `left-pad` in `pnpm-lock.yaml`, reports `cargo-workspace:lockfile` as touched with `{"kind": "project-configuration", "file": "pnpm-lock.yaml"}`, and `app:test` and `util:test` as affected through it (`dependent-output`). This holds with `projectsAffectedByDependencyUpdates` `all` and `auto`, and whether the Rust targets declare `externalDependencies: []` or name the plugin's package. It remained after the lockfile target was given `externalDependencies: []` through `targetDefaults` (the other cause, nxr-f5en6g).

The plugin's inputs cannot take the project's configuration out of a plan, so a fix may need a design change, for example where the root workspace's lockfile task lives, or an accepted limitation in `VER-CACHE-KEYS` and the user guide. Either is a product decision for the maintainer.

The case that shows it is in `nx-rust/test/lockfile-runs.spec.ts`, "nx affected after a change to the JS lockfile", on the branch of nxr-2ermb0.

- [ ] Check which other root files Nx counts as configuration of a root project in Nx 24 (`package.json`, other lockfiles, `nx.json`), record it as evidence in Mara
- [ ] Get the maintainer's decision on a fix or an accepted limitation, and update `DES-LOCKFILE-HASHING` and `VER-CACHE-KEYS`
- [ ] The JS lockfile cases of nxr-2ermb0 pass for the workspace at the repository root, or follow the updated `VER-CACHE-KEYS`
