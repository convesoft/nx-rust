---
title: "0.4: napi and wasm artifacts"
status: done
type: epic
tags:
  - milestone
blocked_by:
  - nxr-9y4eh8
created_at: 2026-11-12T18:20:01Z
closed_at: 2026-11-16T22:14:12Z
---

Build Node addons for the host triple and wasm packages for the browser as named targets that JS projects depend on.

Specified in `nx-rust/docs/artifacts.mara.md`: `REQ-ARTIFACT-TARGETS`, `REQ-ARTIFACT-CACHE`, `DES-ARTIFACT-STEPS`, `DES-WASM`, `DES-NAPI`, and the draft `REQ-MIXED-PROJECTS`. Verification: `VER-ARTIFACTS`.

- [x] All child issues are closed
- [x] `VER-ARTIFACTS` passes
- ~~0.4 is published to npm~~ Cancelled on 14 November 2026: no 0.x milestone is published on its own; publishing is decided at 1.0 (maintainer, `ADR-PUBLISHING-AT-1-0`).
- [x] The status note of `artifacts.mara.md` is updated

## Summary of Changes

Closed by the control plane on 16 November 2026, on local `main` at c6cb73c, after checking the epic's own list.

- All 4 child issues are `done` (the napi spike, the mixed-projects specification, `napi-build`, `wasm-build`). Low-priority and exotic findings of the milestone went to the backlog (tag `backlog`, priority deferred) and are not children.
- `VER-ARTIFACTS`: its sixteen statements are covered by `napi-build.spec.ts` and `wasm-build.spec.ts` (and `VER-MIXED-PROJECTS` by `mixed-projects.spec.ts`), with the real `@napi-rs/cli` 3.10.12 and the real `wasm-bindgen` CLI 0.2.130: each wasm package is loaded in every JS flavour, the `web` one as a browser loads it, and Node loads the addons. On the tree of c6cb73c, on Cargo 1.100.0 with the wasm target and with cargo-nextest, cargo-hakari and wasm-bindgen on `PATH`: `NX_DAEMON=false pnpm nx run-many -t build lint test --skip-nx-cache` gave 64 suites, 1955 tests passed, 1 todo, none skipped. On Cargo 1.91.0: the wasm, napi, init, targets, graph, missing-tools and build-input-check files gave 258 passed, 7 skipped and 1 failed; the 7 skipped are the real-tool wasm cases (no wasm target is installed for 1.91.0 on this machine), and the failure is the known case of backlog issue nxr-8paqsn, which is not part of this milestone. The end-to-end suite passed 27 of 27 on both Cargo versions. Not run: the artifact targets under the `cargo` strategy with a real cargo, which needs a nightly toolchain.
- The status note of `artifacts.mara.md` says that `napi-build` and `wasm-build` work.
- The decisions taken on the maintainer's behalf in this milestone are listed in nxr-bhh3mm; lines 18 and 30 to 32 are provisional.
