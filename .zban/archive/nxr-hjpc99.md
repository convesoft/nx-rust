---
title: Harden plugin entry state wiring against hook destructuring and this rebinding
status: done
type: task
parent: nxr-e2z8sz
created_at: 2026-11-20T10:24:47Z
closed_at: 2026-11-20T13:01:57Z
---

Goal: plugin entry state lookup between `createNodes`, `createDependencies`, and `createMetadata` does not depend solely on `this` object identity from a `get createNodes()` getter side effect.

Context: `nx-rust/src/index.ts` defines `get createNodes()` to construct a new `Registration` whenever Nx copies the module's properties for an `nx.json` entry, and `nx-rust/src/graph/registration.ts` maps `this.createNodes` via a `WeakMap` assuming Nx always invokes `createDependencies` and `createMetadata` with `this` bound to that exact shallow copy (`DES-DISCOVERY`, `DES-PROJECT-GRAPH`, `RISK-UPSTREAM-CHANGES`). Destructuring hooks or changing Nx's plugin wrapper breaks `registrationOf(this)`.

- [x] Audit how Nx 24 passes plugin identity/options to `createNodes`, `createDependencies`, and `createMetadata`, and check whether a fallback keyed by `(workspaceRoot, pluginEntryName)` or project metadata can survive hook destructuring
- [x] Reduce reliance on `get createNodes()` side effects and `queueMicrotask` timing where a more explicit mechanism works cleanly
- [x] Add tests covering single-entry, multi-entry, and unbound/copied-hook invocations

Done when: entry state resolution is resilient and tested, and `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e`, and `pnpm nx format:check --all` pass.

## Summary of Changes

- Audit recorded as `EVD-NX-24-PLUGIN-ENTRIES` (supports `DES-DISCOVERY`, `DES-PROJECT-GRAPH`, `RISK-UPSTREAM-CHANGES`). Nx 24.0.6 spreads the plugin module into one copy per entry: in one process, in a plugin worker per entry, and in the daemon, which reuses the copy across computations. It calls `createNodes[1]` as a plain function and `createDependencies`/`createMetadata` as methods of the copy, passing the entry's single `options` value. The contexts carry nothing entry-specific, `name` is shared by all entries, `index` does not reach the copy, and an entry without options passes `undefined`. A fallback keyed by `(workspaceRoot, pluginEntryName)` or by options therefore cannot tell entries apart. The copy reached through `this` is the only per-entry channel in the public API, so the getter wiring stays.
- Guards (`nx-rust/src/graph/registration.ts`, `nx-rust/src/index.ts`). Graph creation now fails with "nx-rust could not tell which of its entries in nx.json Nx called <hook> for: …" in these cases, instead of answering from another entry's state:
  - a later hook called other than as a method of an entry's copy (destructured or rebound);
  - a later hook given options other than those the entry's `createNodes` received (compared by reference);
  - a `createNodes` call with options other than the copy's first call.
- `queueMicrotask` timing: it lives only in `computation-reports.ts` (outside this issue, and owned by another worker), where it decides only which reports are shared, not which entry a call belongs to. The guards rely on no timing.
- Tests: `nx-rust/test/plugin-entries.spec.ts`.
  - In process: one entry; two entries with their own options and manifests; destructured and rebound hooks; another entry's options; one copy shared by two entries with their own options; two overlapping `createNodes` calls of one entry in one turn, after which `createDependencies` and `createMetadata` answer from the newer (fails on 404f1b6); the same options across computations.
  - Through Nx's own loader: two entries of the plugin with different `include` and `targetNames`, in plugin workers, in Nx's process, with the daemon with workers, and with the daemon in its own process (including a second computation).
- Docs: `DES-DISCOVERY` ("Entries"), `DES-PROJECT-GRAPH` ("Edges"), `RISK-UPSTREAM-CHANGES`, `VER-GRAPH`.

Checks run:
- `pnpm nx run-many -t build lint test`: tests 2006 passed; lint first failed on a conditional expect in the new spec, then passed after the fix, with build and the changed spec rerun green.
- The new spec under `CI=true GITHUB_ACTIONS=true` with agent variables unset: passed.
- `pnpm nx format:check --all`: passed.
- `pnpm nx e2e nx-rust-e2e`: 27 passed.
- `mara schema validate` and `mara project validate`: valid, evaluation complete, 0 errors.
- `zban check`.

## Decisions made

- Keep the per-entry getter and `this` lookup, because the public plugin API offers no other per-entry channel. Guard it, and do not add a fallback that could pick the wrong entry.
- Compare options by reference, not by value: equal options of two entries still belong to two entries. A future Nx that passed each call a fresh copy of the options would fail graph creation clearly until it is supported (`REQ-COMPATIBILITY`).
- Overlapping `createNodes` calls of one entry are not an error (revised after the review of 404f1b6, by the control plane's decision). The daemon can overlap computations, and an isolated worker can dispatch both requests before the plugin lets go of the first computation's reports. A guard that took a shared report cache for one computation failed a valid graph, as the reviewer's paused-worker reproduction showed. Which computation a call belongs to cannot be told from what Nx passes, so `discover` keeps the newest call by `sequence`, as at 3e87698, and the later hooks answer from it.
- Accept the undetected cases and document them in `DES-DISCOVERY`: a copy shared by entries with the same options object or without options; an entry's manifests split between `createNodes` calls of one computation; and one copy's later hook called as a method of another entry's copy with the same options. Nx 24's loader does none of these.

## Review of 404f1b6

- Removed the guard against two `createNodes` calls of one copy in one computation, and the registration's hold on the report cache. The options guards and the copy guard stay.
- Added a unit regression test that drives the interleaving directly: two overlapping calls of one copy, then the later hooks. It fails on 404f1b6 and passes now. I did not make the reviewer's paused-worker reproduction a jest test, because it needs SIGSTOP on Nx's worker and reading socket queues with `ss`, which is Linux-only and timing-dependent.
- Ran the reviewer's script (`nxr-hjpc99-repro.dkzX.py`, with `REVIEW_PLUGIN` set to this branch's build). Both `createNodes` requests were queued at the stopped worker (984 bytes), and `nx show project app --json` exited 0.
- Updated `DES-DISCOVERY` ("Entries": overlapping computations answer from the newest call; the undetected cases; the `createNodes` tuple), `DES-PROJECT-GRAPH`, `VER-GRAPH` and `EVD-NX-24-PLUGIN-ENTRIES`: overlap in the daemon and the worker; workers of unchanged entries kept; the tuple wording.
- Merged `main` at f0f2592. Checks after the change:
  - `pnpm nx run-many -t build lint test`: passed, tests 2006 passed.
  - `pnpm nx e2e nx-rust-e2e`: 27 passed.
  - The new spec under `CI=true GITHUB_ACTIONS=true` with agent variables unset: 12 passed.
  - `pnpm nx format:check --all`: passed.
  - `mara schema validate` and `mara project validate`: valid, evaluation complete, 0 errors.
  - `zban check`: clean.
