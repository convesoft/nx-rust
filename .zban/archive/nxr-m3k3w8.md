---
title: "0.3: nextest, affected tests and the coverage baseline"
status: done
type: epic
tags:
  - milestone
blocked_by:
  - nxr-9y4eh8
created_at: 2026-11-12T18:20:01Z
closed_at: 2026-11-19T08:31:46Z
---

Add the nextest runner, selection of affected tests inside the single `test` target, and the workspace-level target that maintains the coverage baseline.

Specified in `nx-rust/docs/testing.mara.md` and `ci.mara.md`: `REQ-TEST-RUNNER`, `REQ-DOCTESTS`, `REQ-AFFECTED-TESTS`, `REQ-TEST-MODE-KEY`, `REQ-SELECTION-SAFETY`, `REQ-BASELINE`. Verification: `VER-TESTING`.

- [x] All child issues are closed
- [x] `VER-TESTING` passes
- ~~0.3 is published to npm~~ Cancelled on 14 November 2026: no 0.x milestone is published on its own; publishing is decided at 1.0 (maintainer, `ADR-PUBLISHING-AT-1-0`).
- [x] The status notes of `testing.mara.md` and `ci.mara.md` are updated

## Summary of Changes

Closed by the control plane on 19 November 2026, on local `main` at 7c4400b, after checking the epic's own list.

- All 7 child issues are `done`: the two spikes on cargo-affected and the spike on the cost of coverage collection, the nextest runner, the test mode input, the selection of affected tests and the coverage baseline target. Low-priority and exotic findings of the milestone went to the backlog (tag `backlog`, priority deferred) and are not children.
- `VER-TESTING`: its statements are covered by `test-steps.spec.ts`, `nextest-steps.spec.ts`, `nextest-runs.spec.ts`, `test-mode.spec.ts`, `affected-selection.spec.ts`, `affected-runs.spec.ts`, `affected-coverage.spec.ts` and `coverage-baseline.spec.ts`, with the real cargo-nextest 0.9.152, the real cargo-affected 0.4.1 and the `llvm-cov` and `llvm-profdata` of the toolchain. On the tree of 7c4400b, on Cargo 1.100.0 with these tools, cargo-hakari and wasm-bindgen on `PATH`: `NX_DAEMON=false pnpm nx run-many -t build lint test --skip-nx-cache` gave 68 suites, 2046 tests passed, 1 todo (a case that needs cargo-deny, outside this milestone), none skipped. `pnpm nx e2e nx-rust-e2e` gave 27 of 27 on Cargo 1.100.0 and on 1.91.0. On Cargo 1.91.0, the eight files `coverage-baseline`, `affected-coverage`, `affected-selection`, `affected-runs`, `init`, `missing-tools`, `lockfile-runs` and `hakari-runs` gave 197 passed, 12 skipped and 1 todo; 11 of the skipped ones are the real-coverage cases, because the machine has no LLVM tools that match 1.91.0, so real coverage ran on 1.100.0 only, and one is a cargo-hakari case that needs a second target triple, which 1.91.0 lacks here. Without any optional tool, the unit suite gave 1984 passed, 62 skipped and 6 todo, each skipped case with its warning. `pnpm nx format:check --all` passed; `mara schema validate`, `mara project validate` and `zban check` passed at the merge.
- The status notes of `testing.mara.md` and `ci.mara.md` say that the runners, the selection of affected tests and the `coverage-baseline` target work.
- The decisions taken on the maintainer's behalf in this milestone are listed in nxr-sv61dx; lines 10, 21, 44 and 45 are provisional.

Not run anywhere: macOS, a CI runner with the optional tools (backlog nxr-27zbta), the Nx daemon.
