---
title: Narrow build-input-check fixture sweep and move record-selection permutations to unit tests
status: todo
type: task
priority: low
parent: nxr-m7sbwe
created_at: 2026-11-21T20:31:24Z
---

Goal: stop running full `nx run-many -t build` across every trivial fixture in `nx-rust/test/build-input-check.spec.ts` and move pure dep-info record-name selection rules to unit tests (`VER-BUILD-INPUT-CHECK`, `DES-BUILD-INPUT-CHECK`).

Context: measured at `54adf17`, `build-input-check.spec.ts` takes 66.9 s for 50 tests. `it.each(ordinary)` (lines 155–169) builds all 24 ordinary fixtures (26.9 s), most of which differ only in naming/graph/release layout. Many of the remaining 26 tests (40.0 s) spawn real Cargo builds to check pure feature/profile/target-kind record-selection rules (`enabledFeatures`, `nameRecords`). Projected saving: ~32 s suite-time.

- [ ] Narrow `it.each(ordinary)` (`build-input-check.spec.ts:155–169`) to the 6 fixtures with distinct dep-info shapes (`declared-files`, `vendored-crate`, `cross-workspace-path`, `binary-tests`, `napi-addons`, `wasm-packages`)
- [ ] Move pure feature/profile/target-kind record-selection permutations (`rlib`, optional/weak dependency features, `test`/`bench` profiles, shared binary names) to fast in-process unit tests on `enabledFeatures` / `nameRecords`, keeping real-Nx/Cargo checks for build scripts, `include_str!`, proc-macro, symlinks, `dep-info-basedir`, and batched groups
- [ ] Update `VER-BUILD-INPUT-CHECK` in `nx-rust/docs/verification.mara.md` to name the representative fixture set and the unit/real-cargo split
- [ ] Verify with temporary mutations that real-cargo checks still catch undeclared reads and unit checks still catch record-selection bugs, and record before/after timings

Done when: `build-input-check.spec.ts` passes with reported timings, `mara schema validate`, `mara project validate`, `zban check`, `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
