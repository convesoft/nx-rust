---
title: The doc key of a Cargo workspace at the repository root changes with the JS lockfile
status: todo
type: bug
parent: nxr-w9qa5f
related:
  - nxr-5afbsq
discovered_from: nxr-2ermb0
created_at: 2026-11-13T20:55:50Z
---

Goal: decide whether the cache key of `doc` on a workspace project at the repository root may change after a change to the JS lockfile outside the plugin's package, which `VER-CACHE-KEYS` lists under "Keys must not differ after", and either fix it or record the limit in Mara.

Found while working on nxr-2ermb0. In `two-workspaces` with a root `package.json` and `pnpm-lock.yaml` (`pnpmLockfile(null)`, so the Rust targets declare `externalDependencies: []`), after a commit that changes only the integrity of `left-pad`, `nx affected -t doc --base=HEAD~1 --head=HEAD --explain=stdout` with Nx 24.0.6 gives `cargo-workspace:doc` these reasons:

- `{"kind": "input-file", "file": "pnpm-lock.yaml", "pattern": "**/*"}`: the project lies at root `.`, so its `default` named input (`DES-INPUTS`, "Crate files" and "Named input") covers every file that Nx assigns to that project, the JS lockfile and the root `package.json` included.
- `{"kind": "moved-ecosystem", "ecosystem": "npm", "file": "pnpm-lock.yaml"}`: the plan hashes npm packages, probably through edges that Nx's JS plugin draws from the project at the root, which owns the root `package.json`, to its dependencies, and `^default`. Not checked further.
- `project-configuration`, the accepted limit of nxr-5afbsq, and `dependent-output` from the lockfile task.

The first two change the key, not only the selection, so `doc` runs instead of being restored. The rows of `VER-CACHE-KEYS` about the JS lockfile are checked in `subfolder-workspace` only (`nx-rust/test/cache-keys.spec.ts`), whose workspace project is not at the root. A crate whose package lies at the repository root presumably hashes the JS lockfile in the same way, by the "Crate files" rule. Not checked.

- [ ] Check with Nx's hasher which keys of a workspace project at the repository root (and of a root package's crate) change with the JS lockfile and the root `package.json`, and why
- [ ] Get the maintainer's decision on a fix or a documented limit, and update `DES-INPUTS` and `VER-CACHE-KEYS`
- [ ] A cache-key row for the workspace at the repository root that follows the decision
