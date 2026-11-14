---
title: Accepted items say Nx stores nothing for a failed task, which NX_CACHE_FAILURES=true contradicts
status: done
type: bug
tags:
  - spec
discovered_from: nxr-3nv4tn
created_at: 2026-11-14T15:54:06Z
closed_at: 2026-11-14T16:04:11Z
---

Goal: what the accepted items say about failed tasks holds under `NX_CACHE_FAILURES=true`. Either the items name the condition, or the plugin keeps such a failure from being stored. The maintainer decides which.

Context: `EVD-NX-24-BATCHES` (point "`NX_CACHE_FAILURES`") shows that under `NX_CACHE_FAILURES=true` Nx stores and replays failed tasks of the plugin as it is on `main`, which runs one cargo command per task. This covers a failing `test`, and a cached `build` that the executor fails before cargo runs because a crate's `.env` sets `CARGO_BUILD_TARGET`. `EVD-NX-24-LOCKFILE-UPDATE` and `EVD-NX-24-FILE-INPUTS` read the same rule in Nx's source. `DES-DIAGNOSTICS` ("unless `NX_CACHE_FAILURES=true`") and `DES-BUILD-INPUT-CHECK` ("By default") already state the condition. These accepted items state it without the condition:

- `DES-OUTPUTS`: "Nx stores nothing for a failed task" under "Triples that only a task picks" (the case that was run) and under "An artifact directory that moves after graph creation", and "so that Nx stores no result for it" for a task whose configuration caches a target that the plugin leaves uncached
- `DES-LOCKFILE-HASHING`, "Post-check": "Otherwise it fails, so that Nx stores nothing"
- `REQ-EXTERNAL-DEPS`: "No result is stored or restored under a key computed from a lockfile that cargo would still change."
- `VER-CACHE-KEYS`: "fails, and Nx stores nothing for it"
- The guidance of `caching.mara.md` on a `Cargo.lock` that changes during a run: "Nx stores nothing for it; run it again."

Only the `DES-OUTPUTS` triple case and a failing `test` were run. The others rest on the same Nx rule (`shouldCacheTaskResult`, installed `task-orchestrator.js` lines 2097 to 2099).

- [x] ~~The maintainer decides between naming the condition in these items and keeping such failures from being stored~~ Decided by the control plane on 14 November 2026, of which the maintainer is told: the items name the condition (`ADR-CACHED-FAILURES`)
- [x] The decision is applied to the items above, and to the code and its tests if the plugin changes
- [x] `pnpm nx format:write`, then `mara schema validate` and `mara project validate` report `valid: true`

Done when: the items agree with the decision and `mara project validate` reports `valid: true`.

## Summary of Changes

- The control plane decided on 14 November 2026 under `GOAL-TRUSTED-CACHE`, and the maintainer is told, that the items name the condition. `NX_CACHE_FAILURES=true` is the user's own Nx setting, the plugin cannot keep Nx from storing a result its executor reports failed, and a stored failure is replayed as a failure, never as a success. Recorded as the decision `ADR-CACHED-FAILURES` in `decisions.mara.md`, which justifies `DES-OUTPUTS`, `DES-LOCKFILE-HASHING`, `DES-DIAGNOSTICS` and `REQ-EXTERNAL-DEPS`, and which `EVD-NX-24-BATCHES` supports.
- `DES-OUTPUTS`: the three sentences, and a fourth that the new search found ("Option values that cannot be named": "so nothing is stored for them"), now say that Nx stores nothing, or with `NX_CACHE_FAILURES=true` only the failure. A new paragraph, "Failed tasks", states the rule once: by default nothing, with the setting the failure, replayed for the same key, and no successful result stored or restored in either case.
- `DES-LOCKFILE-HASHING`, "Post-check": the same rule for a task that fails the post-check.
- `REQ-EXTERNAL-DEPS`: no successful result is stored or restored under a key computed from a lockfile that cargo would still change, and unless `NX_CACHE_FAILURES=true`, no failure is stored under it either.
- `VER-CACHE-KEYS`: its observable "Nx stores nothing for it" is kept for the default, with `NX_CACHE_FAILURES` unset; no case was added for the setting, because the item stays true without one.
- `DES-DIAGNOSTICS`: the new search found "fails the task when it starts, so that nothing is stored" for `cache` turned on where the plugin leaves it off. It now says that no success is stored, and by default nothing at all, referring to its own "Errors" paragraph, which already named the condition.
- Guidance of `caching.mara.md`: "What is stored" says once what a user with `NX_CACHE_FAILURES=true` gets: a failure whose cause lies outside the key (a `Cargo.lock` that changed during the run, a missing tool, the network) is replayed until an input changes or the cache is cleared with `nx reset`. The lockfile bullet names the condition and links there.
- Left as they are: `DES-BUILD-INPUT-CHECK` and the guidance near it, and the "Errors" paragraph of `DES-DIAGNOSTICS`, which already named the condition; the evidence items, which record runs made without the setting; and statements about `--skip-nx-cache` and keys that never repeat, which are not about failed tasks.
- Checks: `pnpm nx format:write`, `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` (valid: true, evaluation complete, no errors or warnings) and `zban check`, after merging the local `main` at f74f610. No tests ran: only knowledge and issues changed.

Addendum: after merging the local `main` at c2fcb9d (the batching rewording of nxr-gqad20), a further search found `VER-CARGO-UNCHANGED` asserting "and Nx stores nothing" for a cached `build` or `doc` that a task's dotenv file makes fail. That observable is now kept for the default, with `NX_CACHE_FAILURES` unset; it needs no case for the setting. The merge conflicts in `DES-OUTPUTS` and `DES-LOCKFILE-HASHING` kept `main`'s new wording together with the condition. The checks above ran again after this merge, with the same results.
