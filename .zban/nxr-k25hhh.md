---
title: Move configuration and init validation and report permutations to in-process unit tests
status: todo
type: task
priority: low
parent: nxr-m7sbwe
created_at: 2026-11-21T20:31:24Z
---

Goal: move pure TOML metadata validation and `initReport` formatting permutations in `nx-rust/test/configuration.spec.ts` and `nx-rust/test/init.spec.ts` out of full Nx subprocesses (`VER-CONFIGURATION`, `VER-UNKNOWN-OPTIONS`, `VER-SETUP`, `DES-PLUGIN-OPTIONS`, `DES-GENERATORS`).

Context: measured at `54adf17`, `configuration.spec.ts` takes 20.9 s (102 tests) and `init.spec.ts` takes 12.3 s (64 tests). Many tests spawn full Nx graph creation or `nx g @convesoft/nx-rust:init` solely to assert schema/unknown-key/type errors or missing-tool report lines. Projected saving: ~21 s suite-time (~110 Nx spawns converted to <0.2 s unit tests).

- [ ] In `configuration.spec.ts`, keep ~30–35 real-Nx tests for precedence (plugin options → workspace → crate), `mixed-folders` merging, and multi-entry isolation/daemon; move TOML schema errors (`graph-creation errors`, 26 tests), target option type/unknown-key checks (19 tests), and `targetNames` validation to direct unit tests on the config validator
- [ ] In `init.spec.ts`, keep ~20 real `nx g @convesoft/nx-rust:init` tests (fresh repo, idempotency, `extends`, partial defaults, failing graph leaving `nx.json` unchanged, no-`Cargo.toml` repo); move missing-tool-table rows, build-dir formatting and diagnostic wording permutations to direct unit tests on `initReport`
- [ ] Update `VER-CONFIGURATION`, `VER-UNKNOWN-OPTIONS` and `VER-SETUP` in `nx-rust/docs/verification.mara.md`
- [ ] Verify with temporary mutations that real-Nx boundaries and unit checks catch regressions, and record before/after timings

Done when: `configuration.spec.ts` and `init.spec.ts` pass with reported timings, `mara schema validate`, `mara project validate`, `zban check`, `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
