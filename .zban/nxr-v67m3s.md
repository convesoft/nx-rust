---
title: Memoize the baseline task hashes of compareCacheKeys for rows that cannot change them
status: in-progress
type: task
parent: nxr-e2z8sz
blocked_by:
  - nxr-aqgka5
created_at: 2026-11-20T16:38:16Z
---

Goal: `cache-keys.spec.ts` hashes each distinct untouched baseline once, with the real Nx hasher, instead of once per row (`VER-CACHE-KEYS`). No `VER-` item changes.

Context: from the maintainer's audit of the test suites on 20 November 2026, measured at 9d3430a: `nx-rust/test/cache-keys.spec.ts` took 88.3 s for 122 tests and about 244 spawns of `inspect-workspace.cjs`. `compareCacheKeys` (`nx-rust/test/harness/cache-keys.ts`, lines 60-94) spawns a fresh inspector for the `before` state of every row, so identical untouched states are hashed again and again (41 rows on an unmodified `subfolder-workspace`, 10 on `declared-files`, 9 on `patched-workspaces`). It waits for nxr-aqgka5, which changes `cache-keys.spec.ts`.

- [ ] Memoize the `before` record of task hashes per Jest worker, keyed by the serialized `(fixture, base, before, lockfileTask)`, for pure rows only: no `prepare` callback, no environment, file or warning that depends on the checkout's path, no path outside the repository. Every distinct baseline is still computed by the real Nx hasher through `inspect-workspace.cjs` (for all the task ids the rows of that baseline ask for, or extended lazily when a later row asks for another), and every `after` state still runs in a fresh workspace with the real hasher
- [ ] Keep the path without the memo for rows with `prepare` or path-dependent state, and say in a comment which property makes a row pure (`VER-SETUP` already checks that hashes do not depend on the checkout's path)
- [ ] `cache-keys.spec.ts` lines 1828-1868: copy the compiled JS plugin instead of the TypeScript sources, so that Nx does not compile the plugin with swc inside that test
- [ ] Show that a row still fails when its `after` state does not change the key it should, and give the timings before and after

Done when: `cache-keys.spec.ts` passes with unchanged assertions, the timings are reported, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
