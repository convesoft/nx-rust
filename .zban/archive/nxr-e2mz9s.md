---
title: Check that cached Rust tasks replay the unknown-option lines
status: done
type: task
parent: nxr-w9qa5f
blocked_by:
  - nxr-fy4t4k
related:
  - nxr-s12cpg
discovered_from: nxr-wea5vt
created_at: 2026-11-13T16:43:45Z
closed_at: 2026-11-13T20:32:41Z
---

Goal: the cache parts of `VER-UNKNOWN-OPTIONS` (`nx-rust/docs/verification.mara.md`) pass once the plugin caches its targets.

nxr-wea5vt made the executors ignore such options with a line, but no inferred target was cached then (nxr-fy4t4k), so its tests in `nx-rust/test/unknown-options.spec.ts` could not show what `DES-UNKNOWN-OPTIONS`, paragraph "Cache", says: a cache hit replays the lines, and the ignored option stays in the task's key.

- [x] In the first test of `nx-rust/test/unknown-options.spec.ts` ("is left out of every Rust task's command ..."), a second identical `nx run-many -t test build --coverage` restores every Rust task from the cache and prints the same lines
- [x] A run with `passWithNoTests: false` in the `test` entry restores no Rust task

Done when: those checks pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Summary of Changes

The first test of `nx-rust/test/unknown-options.spec.ts` now runs `nx run-many -t test build -p core-lib cli --coverage` with Nx's cache after its cache-skipping runs. A first run stores the results (or restores what the skipped runs already stored, since Nx 24 still writes them), and a second identical run restores `cli:build`, `cli:test`, `core-lib:build` and `core-lib:test`, runs no cargo command and prints the same six lines. Then `passWithNoTests: false` in the `test` entry restores none of them, and every task runs its cargo command again. The product behaves as `DES-UNKNOWN-OPTIONS`, paragraph "Cache", says, so no bug was filed. The cases of the other tests still run without the cache, and the comments now say so.

Checks run: `pnpm nx run-many -t build lint test` (25 suites, 744 tests, all passed), `pnpm nx format:check --all` and `zban check`. No Mara item changed.
