---
title: Share the binary-restore helper of the batch specs and remove the double delete in the test registry's reset
status: todo
type: task
priority: deferred
tags:
  - deferred
  - backlog
discovered_from: nxr-e2z8sz
created_at: 2026-11-21T18:46:55Z
---

Goal: the test harness has one helper for "run the binary, restore from the cache, compare", and the test registry's reset deletes each thing once.

Context: finding 13 of the architecture audit after 0.6 (21 November 2026, at 54adf17). Wave: seam, in the tests.

- `nx-rust/test/batch-builds.spec.ts` (about lines 28-71) and `nx-rust/test/batch-runs.spec.ts` (1024-1043 and 1074-1114) repeat the same pattern of a binary fixture, its run and the check of what the cache restores;
- in `nx-rust/test/harness/registry-server.mts` (about lines 583-589) the reset stops every registry's timers, then calls `registry.reset()` for every named registry, which deletes its `index`, `crates` and `uploads.jsonl`, and then deletes the whole `registries/` folder that holds them;
- `nx-rust/test/harness/sparse-registry.ts` is 793 lines (server lifecycle, and client and index helpers).

- [ ] Move the shared helper into `nx-rust/test/harness/` and use it in both specs, with unchanged assertions
- [ ] In the reset, reset the main registry on disk, clear the named registries' state in memory and remove `registries/` once; the guarantee that `nx-rust/test/README.md` states for the reset stays, and `sparse-registry.spec.ts` passes unchanged
- [ ] Split `sparse-registry.ts` only if a clean cut shows itself; say so otherwise

Done when: `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
