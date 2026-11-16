---
title: "0.2: Batching and feature unification"
status: done
type: epic
tags:
  - milestone
blocked_by:
  - nxr-w9qa5f
created_at: 2026-11-12T18:20:01Z
closed_at: 2026-11-16T18:54:36Z
---

Run the tasks of a group with one cargo call for each step of their target, not one per crate, with features resolved for the whole workspace on every run.

Specified in `nx-rust/docs/execution.mara.md`: `REQ-BATCHING`, `REQ-STABLE-FEATURES`, `DES-BATCH`, `DES-UNIFICATION`, `DES-FEATURE-SETS`. Verification: `VER-BATCHING`.

- [x] All child issues are closed
- [x] `VER-BATCHING` passes
- ~~0.2 is published to npm~~ Cancelled on 14 November 2026: no 0.x milestone is published on its own; publishing is decided at 1.0 (maintainer, `ADR-PUBLISHING-AT-1-0`).
- [x] The status note of `execution.mara.md` is updated

## Summary of Changes

Closed by the control plane on 16 November 2026, on local `main` at ac5bc80, after checking the epic's own list.

- All 26 child issues are `done`. Low-priority and exotic findings of the milestone went to the backlog (tag `backlog`, priority deferred) and are not children.
- `VER-BATCHING`: every paragraph is covered by the test files that cite it (`batch-runs`, `group-run`, `workspace-build`, `test-steps`, `hakari-graph`, `hakari-runs`, `nextest-runs`, `nextest-steps`, `dotenv-check`, `dotenv-equivalence`). On the tree of ac5bc80, with a real cargo-nextest 0.9.152 and cargo-hakari 0.9.39 on `PATH` so that no case is skipped: `NX_DAEMON=false pnpm nx run-many -t build lint test --skip-nx-cache` gave 60 suites, 1865 tests passed, 1 todo, none skipped, on Cargo 1.100.0; the nextest, test-step and hakari files passed on Cargo 1.91.0 (59 passed, 1 skipped); the end-to-end suite passed 27 of 27 on both. Not run: the cases of the `cargo` strategy that need a nightly cargo, which `VER-BATCHING` asks for only where the strategy can be set up.
- The status note of `execution.mara.md` says the page is implemented, apart from the optional strict per-crate build check of the `hakari` strategy (nxr-ys8rx5, backlog).
- The decisions taken on the maintainer's behalf in this milestone are listed in nxr-5rrkay.
