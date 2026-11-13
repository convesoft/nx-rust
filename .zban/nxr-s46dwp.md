---
title: The plugin build puts the README at nx-rust/README.md when Nx runs from nx-rust-e2e
status: todo
type: bug
priority: high
tags:
  - tests
discovered_from: nxr-rq5vqd
created_at: 2026-11-13T13:48:09Z
---

Goal: the `@convesoft/nx-rust` package has its README at the package root wherever the build runs from, so the end-to-end tests install the same layout that a release publishes.

Found while working on nxr-rq5vqd on 13 November 2026, with Nx 24.0.6 on Linux. The build target in `nx-rust/project.json` copies its README with the string asset `"nx-rust/*.md"`. Where it lands depends on the working directory of the Nx process:

- `pnpm nx run-many -t build --skip-nx-cache` from the repository root writes `dist/nx-rust/README.md`.
- The same command from `nx-rust-e2e/` writes `dist/nx-rust/nx-rust/README.md` and no `dist/nx-rust/README.md`.

The end-to-end global setup (`tools/scripts/start-local-registry.ts`) runs Jest's process in `nx-rust-e2e/`, and `releaseVersion` there runs `release.version.preVersionCommand` (`pnpm nx run-many -t build`, `nx.json`). The tarball that a run publishes to the local registry therefore lists `nx-rust/README.md` and has no README at its root. The LICENSE assets, which use `input`/`glob`/`output`, land at the root in both cases.

A build from either folder uses the same Nx cache entry, so the cache key does not cover the working directory, although the output depends on it. An entry written by a build from `nx-rust-e2e/` is restored into a build from the root, a release build included. This is reproduced, first by the reviewer of nxr-rq5vqd's pull request and then on its branch:

1. Remove `dist/` and give Nx an empty cache of its own: `NX_CACHE_DIRECTORY=<empty folder>`, with `NX_DAEMON=false`.
2. From `nx-rust-e2e/`, run `pnpm nx build @convesoft/nx-rust`. The task runs (`Cache: 0/1 hit`) and writes `dist/nx-rust/nx-rust/README.md`.
3. Remove `dist/` again, and run the same command from the repository root with the same cache folder. It reports `[local cache]` and restores only `dist/nx-rust/nx-rust/README.md`, with no README at the package root.

Without those variables, Nx 24.0.6 keeps one cache for every checkout of this repository on a machine, in `~/.nx/<id>/cache`, with `<id>` derived from the git remote. An entry written by an end-to-end run in one worktree can therefore reach a build from the root in another.

- [ ] Make the README asset land at `dist/nx-rust/README.md` whatever the working directory: replace the string asset `"nx-rust/*.md"` in `nx-rust/project.json` (around line 23) with an explicit `input`/`glob`/`output` asset, the form the other assets use
- [ ] Show that a build from `nx-rust-e2e/` and one from the root produce the same files, and that the end-to-end tarball has `README.md` at its root
