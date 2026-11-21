---
title: Move target-defaults rule and message permutations to in-process unit tests
status: todo
type: task
priority: low
parent: nxr-m7sbwe
created_at: 2026-11-21T20:31:24Z
---

Goal: keep real-Nx boundary tests in `nx-rust/test/target-defaults.spec.ts` and move pure rule, filter, lockfile-object and message permutations to direct unit calls (`VER-TARGET-DEFAULT-GUARD`, `DES-TARGET-DEFAULT-GUARD`).

Context: measured at `54adf17` (after `nxr-yatbsx` cut worker-mode duplication from 80.0 s to 26.9 s), `target-defaults.spec.ts` still runs 118 tests in 26.9 s by spawning a fresh Nx graph process for every permutation of `findTargetDefaultChanges` / `describeTargetDefaultChanges`. Projected saving: ~19 s suite-time (~85 Nx spawns converted to <0.2 s unit tests).

- [ ] Keep ~25–30 real-Nx tests covering every process/layer boundary (the 6 plugin-worker cases + 1 real-Nx test per layer: `nx.json` object/list, `extends`, `project.json`, `package.json`, prior plugin, later plugin, `init` guard, renamed project refs)
- [ ] Move the remaining ~85 rule, filter, explicit-lockfile-dependency and message-formatting permutations to direct unit calls on `findTargetDefaultChanges` / `describeTargetDefaultChanges` (and `target-defaults-meaning.ts`)
- [ ] Update `VER-TARGET-DEFAULT-GUARD` in `nx-rust/docs/verification.mara.md` to record which cases run through real Nx vs direct unit calls
- [ ] Verify with temporary mutations that both the Nx/worker integration boundaries and the moved rule unit tests catch regressions, and record before/after timings

Done when: `target-defaults.spec.ts` passes with reported timings, `mara schema validate`, `mara project validate`, `zban check`, `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
