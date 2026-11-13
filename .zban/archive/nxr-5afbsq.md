---
title: Nx counts the JS lockfile as configuration of a Cargo workspace project at the repository root, so nx affected selects its lockfile task and crates
status: done
type: bug
parent: nxr-w9qa5f
related:
  - nxr-f5en6g
discovered_from: nxr-2ermb0
created_at: 2026-11-13T20:47:15Z
closed_at: 2026-11-13T21:03:20Z
---

Goal: `nx affected` behaves as the end-to-end paragraph of `VER-CACHE-KEYS` says after a commit that changes only the JS lockfile also where a Cargo workspace lies at the repository root, or Mara records why it cannot and what the repository then sees.

Found while working on nxr-2ermb0. In `two-workspaces` the virtual workspace at the repository root has its workspace project `cargo-workspace` at root `.` (`TERM-WORKSPACE-PROJECT`, `DES-WORKSPACE-TARGETS`), which owns the lockfile task (`DES-LOCKFILE-HASHING`). `pnpm-lock.yaml` matches the `createNodes` pattern of Nx's own `nx/js/dependencies-and-lockfile` plugin and lies in that project's folder, so Nx 24.0.6 counts it as a configuration file of `cargo-workspace`, which every hash plan of the project's tasks holds. `nx affected -t test --base=HEAD~1 --head=HEAD --explain=stdout`, after a commit that changes only the integrity of `left-pad` in `pnpm-lock.yaml`, reports `cargo-workspace:lockfile` as touched with `{"kind": "project-configuration", "file": "pnpm-lock.yaml"}`, and `app:test` and `util:test` as affected through it (`dependent-output`). This holds with `projectsAffectedByDependencyUpdates` `all` and `auto`, and whether the Rust targets declare `externalDependencies: []` or name the plugin's package. It remained after the lockfile target was given `externalDependencies: []` through `targetDefaults` (the other cause, nxr-f5en6g).

The plugin's inputs cannot take the project's configuration out of a plan, so a fix may need a design change, for example where the root workspace's lockfile task lives, or an accepted limitation in `VER-CACHE-KEYS` and the user guide. Either is a product decision for the maintainer.

The case that shows it is in `nx-rust/test/lockfile-runs.spec.ts`, "nx affected after a change to the JS lockfile", on the branch of nxr-2ermb0.

- [x] Record as evidence in Mara that Nx counts the JS lockfile as configuration of a project at the repository root
- [x] Get the maintainer's decision on a fix or an accepted limitation, and update `DES-LOCKFILE-HASHING` and `VER-CACHE-KEYS`
- [x] The JS lockfile cases of nxr-2ermb0 pass for the workspace at the repository root, or follow the updated `VER-CACHE-KEYS`

## Summary of Changes

The maintainer accepted this as a documented limit, with no code change. Nx counts the JS lockfile as configuration of a project at the repository root. For a Cargo workspace whose project lies there, `nx affected` therefore selects that project's tasks and, through its lockfile task, the tasks of its crates after any change to the JS lockfile. The crate tasks are restored from the cache, and only the uncached lockfile task runs. This is now stated in `DES-LOCKFILE-HASHING` ("nx affected"), in the end-to-end paragraph of `VER-CACHE-KEYS` and in the caching guide (`nx-rust/docs/caching.mara.md`). The observation is a dated bullet in `EVD-NX-24-PLUGIN-VERSION`. Only the JS lockfile was checked, not other root files such as `package.json` or `nx.json`, because the decision concerns the JS lockfile.

While checking the limit, `nx affected --explain` showed that the `doc` key of a workspace project at the repository root also changes with the JS lockfile, not only its selection. That is filed as nxr-q3eqa8.

Checks: the four JS lockfile cases in `nx-rust/test/lockfile-runs.spec.ts` expect exactly this selection for the workspace at the root (its crate `test` tasks restored, its lockfile task run) and pass. `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e --skip-nx-cache`, `mara schema validate`, `mara project validate` and `zban check` pass.
