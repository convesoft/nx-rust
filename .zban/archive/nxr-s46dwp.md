---
title: The plugin build puts the README at nx-rust/README.md when Nx runs from nx-rust-e2e
status: done
type: bug
priority: high
tags:
  - tests
discovered_from: nxr-rq5vqd
created_at: 2026-11-13T13:48:09Z
closed_at: 2026-11-13T14:37:54Z
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

- [x] Make the README asset land at `dist/nx-rust/README.md` whatever the working directory: replace the string asset `"nx-rust/*.md"` in `nx-rust/project.json` (around line 23) with an explicit `input`/`glob`/`output` asset, the form the other assets use
- [x] Show that a build from `nx-rust-e2e/` and one from the root produce the same files, and that the end-to-end tarball has `README.md` at its root

## Summary of Changes

- `nx-rust/project.json`: the README asset is now `{ "input": "./nx-rust", "glob": "*.md", "output": "." }`. Cause, in `@nx/js` 24.0.6 (`normalizeAssets`): a string asset takes `path.relative(context.root, projectRoot)` as its input, and `projectRoot` (`nx-rust`) is relative, so Node resolves it against the process's working directory. From `nx-rust-e2e/` the input becomes `nx-rust-e2e/nx-rust`, the README lies outside it, and Nx copies it under its full source path. Object assets compute both sides from relative paths and do not depend on the working directory.
- `nx-rust-e2e/src/nx-rust.spec.ts`: a new test checks that the installed package has `README.md`, `LICENSE-APACHE` and `LICENSE-MIT` at its root, with the contents of their sources. The comparison with `dist/nx-rust` from #18 cannot catch this, because the wrong layout is in both.
- Other paths checked: the release manifest root, the publish `packageRoot` and the registry storage resolve against the workspace root. `release.version.preVersionCommand` inherits the working directory, which is how the build ran from `nx-rust-e2e/`; with the asset fixed the build output no longer depends on it.
- When the defect reached the tarball: `pnpm nx e2e nx-rust-e2e` first builds the plugin from the root (`^build`), and the `preVersionCommand` build then hits that cache entry. The tarball got `nx-rust/README.md` only when the inner build ran, as with `--skip-nx-cache` (passed to tasks as `NX_SKIP_NX_CACHE=true`), or when the cache held an entry from a build in `nx-rust-e2e/`.
- Stale cache entries: nothing more is needed. `nx-rust/project.json` is an input of the build, so after the fix a build from the root with a private cache that holds a pre-fix entry written from `nx-rust-e2e/` reported `0/1 hit` and wrote `README.md` at the root.

Checks run, all with `NX_DAEMON=false` and a private `NX_CACHE_DIRECTORY`:

- `pnpm nx build @convesoft/nx-rust` from the root and from `nx-rust-e2e/`, each with an empty cache: before the fix the file lists differed only in `README.md` vs `nx-rust/README.md`. After the fix they are identical and the same as a pre-fix build from the root.
- `pnpm nx e2e nx-rust-e2e`: 8 of 8 passed, and the tarball lists `README.md` at its root.
- `pnpm nx e2e nx-rust-e2e --skip-nx-cache` with the old `project.json`: the tarball lists `nx-rust/README.md` and the new test fails with ENOENT for `README.md` (1 failed, 7 passed). With the fix: 8 of 8 passed, and `tar tzf` of the published tarball shows `package/README.md`.
- `pnpm nx run-many -t build lint test`: passed (63 unit tests). `pnpm nx format:check --all`: passed.
- `mara schema validate` and `mara project validate`: valid, evaluation complete, no diagnostics. `zban check`: run before committing.
