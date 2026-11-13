---
title: Check that cached Rust tasks replay the unknown-option lines
status: todo
type: task
parent: nxr-w9qa5f
blocked_by:
  - nxr-fy4t4k
related:
  - nxr-s12cpg
discovered_from: nxr-wea5vt
created_at: 2026-11-13T16:43:45Z
---

Goal: the cache parts of `VER-UNKNOWN-OPTIONS` (`nx-rust/docs/verification.mara.md`) pass once the plugin caches its targets.

nxr-wea5vt made the executors ignore such options with a line, but no inferred target was cached then (nxr-fy4t4k), so its tests in `nx-rust/test/unknown-options.spec.ts` could not show what `DES-UNKNOWN-OPTIONS`, paragraph "Cache", says: a cache hit replays the lines, and the ignored option stays in the task's key.

- [ ] In the first test of `nx-rust/test/unknown-options.spec.ts` ("is left out of every Rust task's command ..."), a second identical `nx run-many -t test build --coverage` restores every Rust task from the cache and prints the same lines
- [ ] A run with `passWithNoTests: false` in the `test` entry restores no Rust task

Done when: those checks pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
