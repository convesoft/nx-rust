---
title: Move CLI-flag, shell-quoting, binary-test shape and executable-overlap rules to unit tests
status: todo
type: task
priority: low
parent: nxr-m7sbwe
created_at: 2026-11-21T20:31:24Z
---

Goal: move pure CLI-flag assembly, shell quoting, crate-shape edge inference and executable-name overlap rules out of full Cargo/Nx runs in `executors.spec.ts`, `verbose-command.spec.ts`, `test-after-build.spec.ts` and `shared-executables.spec.ts` (`VER-TARGETS`, `VER-CARGO-UNCHANGED`).

Context: measured at `54adf17`, these four specs take 99.0 s across 83 tests (`executors`: 31.5 s / 33, `verbose-command`: 22.5 s / 12, `test-after-build`: 23.9 s / 12, `shared-executables`: 21.1 s / 26). Projected saving: ~47 s suite-time.

- [ ] `executors.spec.ts`: move pure cargo-flag assembly assertions to unit tests on `groupInvocations`, keeping ~16 real-Nx execution/batching/tool checks
- [ ] `verbose-command.spec.ts`: keep ~5–6 real `nx` + `sh` round-trips (build, failing test, lockfile, batch, cache hit), moving quoting/formatting permutations to unit tests and dropping redundant daemon duplicates
- [ ] `test-after-build.spec.ts`: keep 1 hold test + restore + executor-guard runs, and verify the 11-crate `binary-tests` edge-inference rule in-process on `cargo metadata`
- [ ] `shared-executables.spec.ts`: keep ~12 real-Nx runs (same workspace, cross-workspace, nested target-dir, rename, uncached guard) and unit-test path-overlap and warning-text permutations
- [ ] Update `VER-TARGETS` and `VER-CARGO-UNCHANGED` in `nx-rust/docs/verification.mara.md`
- [ ] Verify with temporary mutations and record before/after timings

Done when: all four specs pass with reported timings, `mara schema validate`, `mara project validate`, `zban check`, `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
