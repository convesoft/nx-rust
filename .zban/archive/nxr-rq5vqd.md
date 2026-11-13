---
title: The end-to-end tests can install a stale plugin from pnpm's metadata cache
status: done
type: bug
tags:
  - tests
discovered_from: nxr-7n0nqf
created_at: 2026-11-13T10:41:08Z
closed_at: 2026-11-13T13:49:34Z
---

Goal: `pnpm nx e2e nx-rust-e2e` always tests the plugin that its global setup has just built and published, on a developer machine as in CI.

Found while working on nxr-7n0nqf on 13 November 2026, with pnpm 12.18.0 on Linux. Every run publishes the plugin to the local registry (`http://localhost:4873`) under the same version, `0.0.0-e2e` (`tools/scripts/start-local-registry.ts`). pnpm keeps registry metadata in a cache shared by all checkouts of a user (`~/.cache/pnpm/v12/metadata/http%3A+localhost+4873/@convesoft/nx-rust.jsonl`). When that cache holds the metadata of an earlier publish, `pnpm add -D @convesoft/nx-rust@e2e` in `nx-rust-e2e/src/nx-rust.spec.ts` resolves the old integrity and reuses the old package from the store ("resolved 1, reused 3, downloaded 0"), so the tests run against an earlier build. The cached integrity differed from the one in `tmp/local-registry/storage/@convesoft/nx-rust/package.json`.

A test that expects the new behaviour then fails, and a test that should fail can pass. CI starts with empty caches and is not affected. Running the suite with `npm_config_cache_dir` and `pnpm_config_cache_dir` pointing at an empty folder made pnpm download the fresh package, and the suite passed.

- [x] Make the test project's install ignore cached metadata of earlier publishes, for example with a cache folder of its own under `tmp/` or a version that is unique per run
- [x] Show that a run after a publish of different content installs the new package

## Summary of Changes

- `tools/scripts/start-local-registry.ts` gives pnpm a metadata cache of its own, `tmp/local-registry/pnpm-cache` at the repository root, through `pnpm_config_cache_dir`. The global setup empties it before it starts the registry, whose storage the executor clears at the same moment, so pnpm knows only what the current run published. The variable lives only in the Jest process and the commands it starts, so a plain `pnpm install` in the repository is unchanged. pnpm's content-addressed store stays shared: a package is still reused when its integrity matches.
- `nx-rust-e2e/src/nx-rust.spec.ts` gains "installs the plugin that the global setup built". It compares a SHA-256 digest of every file of the installed `@convesoft/nx-rust` with `dist/nx-rust`, so a stale install now fails the suite instead of testing an earlier build.
- Rejected: a version unique per run. Every run would leave a new package in the shared store, and pnpm could still trust a cached `e2e` dist-tag. Setting `npm_config_cache_dir` as well is not needed: pnpm 12 reads `pnpm_config_*`.

How it was shown, with pnpm 12.18.0 on Linux and the user's shared cache untouched. Its `http%3A+localhost+4873/@convesoft/nx-rust.jsonl` entry held an earlier publish (`sha512-0w7envdW…`) and kept the same SHA-256 through every run below:

- Before the fix, the suite ran with `pnpm_config_cache_dir` pointing at a copy of the shared cache. pnpm reported "resolved 1, reused 3, downloaded 0" and installed the old package: 3 files under `src/` against 18 built. The new test and "reads the fixture's workspace through the installed plugin" failed (2 failed, 5 passed).
- Run A, with the fix: the run published `sha512-grS5fCtd…`, and all 7 tests passed.
- Run B, after a publish of different content (a line appended to `nx-rust/README.md`, reverted afterwards): the run published `sha512-7Uo9juIZ…`, pnpm reported "resolved 1, reused 2, downloaded 1", the private cache held the new integrity, and all 7 tests passed.

Checks run: `pnpm nx run-many -t build lint test` (63 tests passed), `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e --skip-nx-cache` on the final code (7 passed), `mara schema validate` and `mara project validate` (valid, complete evaluation) and `zban check`. CI on the pull request covers the empty-cache case.

The same checks passed again after `origin/main` (1a7fb29) was merged into the branch. One end-to-end run in between failed in the global setup on an error in Nx's task database, left its registry running, and hung the next run; once those processes were stopped, the suite passed.

Found on the way and filed:

- nxr-s46dwp: when Nx runs from `nx-rust-e2e/`, the plugin build puts the README at `nx-rust/README.md`, and Nx's cache carries that layout into builds from the root.
- nxr-f6f9gh: a failed end-to-end global setup leaves the local registry running, and the next run hangs.
