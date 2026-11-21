---
title: Deduplicate warning cache-replay cycles and post-cargo lockfile race runs
status: todo
type: task
priority: low
parent: nxr-m7sbwe
created_at: 2026-11-21T20:31:24Z
---

Goal: eliminate redundant multi-step `nx` / `nx reset` cycles in `nx-rust/test/warnings.spec.ts` and duplicate post-cargo mismatch runs in `nx-rust/test/lockfile-runs.spec.ts` (`VER-SETUP`, `VER-TARGET-DEFAULT-GUARD`, `VER-CACHE-KEYS`).

Context: measured at `54adf17`, `warnings.spec.ts` takes 49.0 s (33 tests) and `lockfile-runs.spec.ts` takes 59.6 s (30 tests). `warnings.spec.ts` repeats the 8-command `stepsOfCause` cycle (line 123) across multiple warning causes that share one `warningsDigest` named-input mechanism; `lockfile-runs.spec.ts` spends 28.2 s on 14 post-cargo mismatch tests and 9.5 s on 2 `--exclude-task-dependencies` tests. Projected saving: ~66 s suite-time.

- [ ] In `warnings.spec.ts`, keep 2 full `stepsOfCause` cache+reset cycles—one `targetDefaults` warning in a plugin worker and one graph warning (`.gitignore`/Cargo)—plus daemon delivery; check each additional warning cause via a single graph assertion or unit check on `warningsDigest`
- [ ] In `lockfile-runs.spec.ts`, consolidate `the check after cargo's call` (14 tests → ~6 distinct race scenarios: own digest moved, sibling moved under `workspace-build`, sibling moved under `hakari` shared vs single, concurrent `nx` commands, `NX_CACHE_FAILURES=true`) and combine `--exclude-task-dependencies` flag spellings into one workspace flow
- [ ] Update `VER-SETUP`, `VER-TARGET-DEFAULT-GUARD` and `VER-CACHE-KEYS` in `nx-rust/docs/verification.mara.md`
- [ ] Verify with temporary mutations and record before/after timings

Done when: `warnings.spec.ts` and `lockfile-runs.spec.ts` pass with reported timings, `mara schema validate`, `mara project validate`, `zban check`, `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
