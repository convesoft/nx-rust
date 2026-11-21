---
title: Deduplicate cache-keys and lockfile-keys real-Nx hasher rows by input mechanism
status: todo
type: task
priority: low
parent: nxr-m7sbwe
created_at: 2026-11-21T20:31:24Z
---

Goal: reduce redundant `inspect-workspace.cjs` spawns in `nx-rust/test/cache-keys.spec.ts` and `nx-rust/test/lockfile-keys.spec.ts` by testing each Nx hashing mechanism once against the real hasher and verifying input-list completeness in-process (`VER-CACHE-KEYS`, `DES-INPUTS`, `DES-LOCKFILE-HASHING`).

Context: measured at `54adf17`, `cache-keys.spec.ts` takes 71.5 s (123 tests, ~250 Nx hasher spawns) and `lockfile-keys.spec.ts` takes 22.9 s (17 tests, 2 lockfile tasks + 2 hash runs each). Many rows exercise the exact same Nx input primitive (5 rows for files in the crate's folder, 4 for dep hops, 10 for `envInputs`/`runtimeInputs` on non-edge crates, 8 for compiler overrides, 8 for test mode, and pure digest cases already covered in `lockfile-digest.spec.ts` in 0.1 s). Projected saving: ~57 s suite-time.

- [ ] Deduplicate `cache-keys.spec.ts` matrix rows that repeat the same Nx hashing mechanism (crate-folder files, dependency hops, non-edge `envInputs`/`runtimeInputs`, compiler-path overrides, test-mode variants), moving completeness assertions to fast in-process tests on the plugin's input/runtime-command builders
- [ ] Trim `lockfile-keys.spec.ts` to the ~10 core real-Nx rows (direct/transitive bump, ignored `Cargo.lock`, cross-workspace, `[replace]`, git commit, stale lockfile, `workspace-build` vs `hakari` isolation), keeping pure digest rules in `lockfile-digest.spec.ts`
- [ ] Update `VER-CACHE-KEYS` in `nx-rust/docs/verification.mara.md` to distinguish real-Nx-hasher mechanism checks from in-process input-builder / digest checks
- [ ] Verify with temporary mutations that removing an input primitive still fails the real-Nx matrix and omitting a specific entry fails the unit checks, and record before/after timings

Done when: `cache-keys.spec.ts` and `lockfile-keys.spec.ts` pass with reported timings, `mara schema validate`, `mara project validate`, `zban check`, `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
