---
title: Narrow batch-runs waysOfRunning from 11 to 5 distinct Nx execution paths
status: todo
type: task
priority: low
parent: nxr-m7sbwe
created_at: 2026-11-21T20:31:24Z
---

Goal: cut the critical-path runtime of `nx-rust/test/batch-runs.spec.ts` by narrowing `waysOfRunning` from 11 ways to 5 distinct Nx execution paths (`VER-BATCHING`, `DES-BATCH`).

Context: measured at `54adf17` (after `nxr-gabd3d`), `batch-runs.spec.ts` is the #1 slowest suite at 92.4 s (27 tests), of which `the environment of a task in a batch` takes 52.9 s (including one 29.5 s test running 40 Nx spawns). On Nx 24.0.6, `--output-style=dynamic` in a sized PTY invokes the exact same terminal-UI renderer as `--tui`, and several non-PTY/PTY variants overlap. This revisits decision #28 in `nxr-vk19v5` (approved by the maintainer in the 21 November 2026 test-suite review thread). Projected saving: ~35–45 s suite-time.

- [ ] Narrow `waysOfRunning` (`batch-runs.spec.ts:375`) to 5 distinct Nx execution paths: `static` (no daemon), `stream` (no daemon), `static` in PTY, `stream-without-prefixes` in PTY with daemon, and `--tui` in PTY with daemon
- [ ] Keep all environment assertions (`expectOneEnvironment`, root `.env`, `NX_LOAD_DOT_ENV_FILES=false`, dotenv check, vault failure) unchanged on the 5 paths
- [ ] Update `VER-BATCHING` in `nx-rust/docs/verification.mara.md` to name the 5 execution paths and note why `--output-style=dynamic` and overlapping styles were dropped
- [ ] Verify with a temporary mutation (`NX_RUST_TEMP_PROBE=batch` in `src/executors/batch.ts`, as in `nxr-gabd3d`) that the dump tests still fail when batch and single-run environments diverge, and record before/after timings

Done when: `batch-runs.spec.ts` passes with reported timings (including in CI mode: `env -u CLAUDECODE -u CLAUDE_CODE -u AI_AGENT -u CODEX_THREAD_ID CI=true GITHUB_ACTIONS=true`), `mara schema validate`, `mara project validate`, `zban check`, `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
