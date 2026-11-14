---
title: Update Cargo.lock after nx release version
status: todo
type: feature
parent: nxr-6q2chq
blocked_by:
  - nxr-1ckcy8
  - nxr-52c1bx
discovered_from: nxr-5fp9d3
created_at: 2026-11-14T15:48:27Z
---

Goal: after `nx release version`, each changed Cargo workspace's `Cargo.lock` is current and part of Nx's release commit.

Implements the Lockfile paragraph of `DES-RELEASE` (`nx-rust/docs/release.mara.md`). Checked by group 4 of `VER-RELEASE`. Needs the version actions module (nxr-1ckcy8), which records the workspaces whose manifests it changed, and the harness registry (nxr-52c1bx) for the cases with a newer registry version and with the registry stopped.

- [ ] `afterAllProjectsVersioned` in the version actions module runs `cargo update --workspace` in the root folder of each workspace whose manifests the run changed, online and never with `--locked`, also in locked mode
- [ ] It returns the lockfiles that cargo changed and that git does not ignore, paths as Nx expects them, and runs nothing in a dry run
- [ ] A cargo failure fails the release with a message that names the workspace and carries cargo's message

Done when: group 4 of `VER-RELEASE` passes on cargo 1.91 and the latest stable, and `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all` and `pnpm nx e2e nx-rust-e2e` pass.
