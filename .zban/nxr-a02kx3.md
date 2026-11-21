---
title: Trim duplicate daemon and option-attribution runs in unknown-options and run-arguments
status: todo
type: task
priority: low
parent: nxr-m7sbwe
created_at: 2026-11-21T20:31:24Z
---

Goal: stop duplicating every `run` argument/continuous-dependency case under `NX_DAEMON=true` in `nx-rust/test/run-arguments.spec.ts` and move pure option-origin attribution checks in `nx-rust/test/unknown-options.spec.ts` to unit tests (`VER-UNKNOWN-OPTIONS`, `VER-TARGETS`).

Context: measured at `54adf17`, `unknown-options.spec.ts` takes 29.2 s (19 tests) and `run-arguments.spec.ts` takes 17.7 s (13 tests). `run-arguments.spec.ts` (lines 56–145) runs its 8-case loop and 2×2 continuous-dependency matrix both with and without the Nx daemon; `unknown-options.spec.ts` runs full `nx run-many` for pure option-source attribution variants. Projected saving: ~26 s suite-time.

- [ ] In `run-arguments.spec.ts`, keep 1 representative daemon test proving `--` forwarding parity with `NX_DAEMON=true` and run the remaining argument and continuous-dependency permutations without the daemon
- [ ] In `unknown-options.spec.ts`, move pure option-source attribution (`project.json`, `package.json`, `targetDefaults`, configurations, forwarded options) and message formatting to unit tests, keeping ~8–10 real-Nx runs covering CLI/config warnings, caching, batching and `runExecutor`
- [ ] Update `VER-UNKNOWN-OPTIONS` and `VER-TARGETS` in `nx-rust/docs/verification.mara.md`
- [ ] Verify with temporary mutations and record before/after timings

Done when: `unknown-options.spec.ts` and `run-arguments.spec.ts` pass with reported timings, `mara schema validate`, `mara project validate`, `zban check`, `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
