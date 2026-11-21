---
title: Deduplicate stale-daemon lifecycles in caching-runs and artifact-folders
status: todo
type: task
priority: low
parent: nxr-m7sbwe
created_at: 2026-11-21T20:31:24Z
---

Goal: stop spinning up 6 separate Nx daemons across `nx-rust/test/caching-runs.spec.ts` and `nx-rust/test/artifact-folders.spec.ts` for config-file precedence variants of the same stale-graph guard (`VER-CARGO-UNCHANGED`, `VER-CACHE-KEYS`).

Context: measured at `54adf17`, `caching-runs.spec.ts` takes 45.3 s (23 tests) and `artifact-folders.spec.ts` takes 29.0 s (14 tests). Each file runs 3 separate `NX_DAEMON=true` tests (~4.2 s each, ~25 s combined) for `CARGO_HOME/config.toml`, parent `.cargo/config.toml` and removed config (`artifact-folders.spec.ts:124–141`). Projected saving: ~40 s suite-time.

- [ ] Keep 1 stale-daemon test per file to verify the daemon stale-graph boundary, and test config-file precedence variations (`CARGO_HOME` vs parent `.cargo/config.toml` vs removed setting) without daemon restarts or in unit tests
- [ ] Trim any remaining duplicate cold-build sequences in `caching-runs.spec.ts` and `artifact-folders.spec.ts` that re-verify the same restore/guard path
- [ ] Update `VER-CARGO-UNCHANGED` and `VER-CACHE-KEYS` in `nx-rust/docs/verification.mara.md`
- [ ] Verify with temporary mutations that breaking the stale-directory/triple guard still fails the remaining daemon test, and record before/after timings

Done when: `caching-runs.spec.ts` and `artifact-folders.spec.ts` pass with reported timings, `mara schema validate`, `mara project validate`, `zban check`, `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
