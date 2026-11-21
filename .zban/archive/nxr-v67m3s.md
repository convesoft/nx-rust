---
title: Memoize the baseline task hashes of compareCacheKeys for rows that cannot change them
status: done
type: task
parent: nxr-e2z8sz
blocked_by:
  - nxr-aqgka5
created_at: 2026-11-20T16:38:16Z
closed_at: 2026-11-20T20:43:26Z
---

Goal: `cache-keys.spec.ts` hashes each distinct untouched baseline once, with the real Nx hasher, instead of once per row (`VER-CACHE-KEYS`). No `VER-` item changes.

Context: from the maintainer's audit of the test suites on 20 November 2026, measured at 9d3430a: `nx-rust/test/cache-keys.spec.ts` took 88.3 s for 122 tests and about 244 spawns of `inspect-workspace.cjs`. `compareCacheKeys` (`nx-rust/test/harness/cache-keys.ts`, lines 60-94) spawns a fresh inspector for the `before` state of every row, so identical untouched states are hashed again and again (41 rows on an unmodified `subfolder-workspace`, 10 on `declared-files`, 9 on `patched-workspaces`). It waits for nxr-aqgka5, which changes `cache-keys.spec.ts`.

- [x] Memoize the `before` record of task hashes per test file for pure rows, with every distinct baseline still hashed by the real Nx hasher and every `after` state fresh: built, checked and measured, then removed (not kept, see the summary)
- [x] Keep the path without the memo for rows with `prepare` or path-dependent state: done while the memo existed; with the memo removed, every row takes that path
- [x] `cache-keys.spec.ts`: copy the compiled JS plugin instead of the TypeScript sources in the plugin-version test: built and measured, then reverted, because it saved less than a second
- [x] Show that a row still fails when its `after` state does not change the key it should, and give the timings before and after: done for the memo (see the summary)

Done when: `cache-keys.spec.ts` passes with unchanged assertions, the timings are reported, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Summary of Changes

Nothing in the source or the tests changes; the issue closes with its finding.

Finding: keyed by the real first state of a row (the files on disk once the fixture, base and first state are in place, the state's variables and options, and the test process's environment), only 13 rows of `cache-keys.spec.ts` share one first state, the untouched `subfolder-workspace`; the other distinct first states have one to four rows each. The audit's estimate (41 rows on an unmodified `subfolder-workspace`, 10 on `declared-files`, 9 on `patched-workspaces`) counted rows that look alike, but most of them differ in a variable, a file or the base. A memo per test file, which served a first state's hash only after two hashings in two workspaces at different paths agreed, saved 17 of 281 spawns of `inspect-workspace.cjs` (264 with the memo): 63.7 and 65.0 s against 66.7 and 66.8 s on `main` (`berth --exclusive`, `maxWorkers` 3), within the run-to-run variation. Without the confirmation step it could have saved about 38 spawns, at the cost of letting a row pass against a baseline that differs by accident.

The memo was checked three ways, with temporary changes that were removed afterwards:

- Wrong memo key: in a temporary spec, only an untouched row after two confirmations was served from the memo; a row that removes a variable, one that sets a variable, the same two appends to a file in the other order, and an untouched row after the test process's environment changed each got a key of its own, and rows with a variable or a file naming a folder outside the repository, or with `prepare`, stayed off the memo.
- Path-dependent baseline: with a temporary `{ runtime: "pwd" }` input in `src/graph/inputs.ts`, no first state was confirmed (0 served, 98 hashed) and all 123 tests passed.
- A key that stops covering its input: with `lint` and `fmt-check` no longer covering `clippy.toml` and `rustfmt.toml`, the rows about those files were served from the memo and failed.

The memo was not kept, by the orchestrator's decision: it added a keyed cache with purity rules to the harness of the `VER-CACHE-KEYS` test for no measurable gain, and a harness that hashes every state afresh cannot pass a row against a wrong baseline.

The plugin-version test copying the compiled plugin package instead of the TypeScript sources was measured alone (`--testNamePattern="differ for another version of the plugin"`, `berth --exclusive`, the suite's time with only that test selected): 0.844, 0.829 and 0.827 s without the change, 0.656, 0.649 and 0.657 s with it, a median drop of 0.18 s, below the 1 s that would justify it. It was reverted, so nothing was kept.

Checks run on the merged branch: `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` and `zban check`. `cache-keys.spec.ts` no longer changes, so its runs on Cargo 1.91 and as CI runs it were not repeated; they passed with the memo. The end-to-end suite was not needed: the built plugin does not change.
