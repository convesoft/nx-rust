---
title: The plugin build puts the README at nx-rust/README.md when Nx runs from nx-rust-e2e
status: todo
type: bug
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

A build from either folder hits the same Nx cache entry (`[local cache]` both times after one build from the root), so the cache key does not cover the working directory while the output depends on it. An entry written by a build from `nx-rust-e2e/` could be restored into a build from the root, a release build included. This was not reproduced; it follows from the two observations.

- [ ] Make the README asset land at `dist/nx-rust/README.md` whatever the working directory, for example with the `input`/`glob`/`output` form the other assets use
- [ ] Show that a build from `nx-rust-e2e/` and one from the root produce the same files, and that the end-to-end tarball has `README.md` at its root
