---
title: Accept either parallel Cargo failure order in group-run.spec.ts
status: done
type: bug
priority: high
discovered_from: nxr-7gm46w
created_at: 2026-11-22T10:54:29Z
closed_at: 2026-11-22T11:03:09Z
---

In `nx-rust/test/group-run.spec.ts:212-226`, the test asserts the exact string `` cargo reported `breakable` and `scripted` as failed ``. Because Cargo builds `breakable` and `scripted` in parallel, CI can report `` `scripted` and `breakable` `` instead (the same race fixed in `batch-runs.spec.ts` under `nxr-7gm46w`), causing `Unit tests (shard 4/4)` to fail twice in a row on PR #85.

- [x] Match either `` `breakable` and `scripted` `` or `` `scripted` and `breakable` `` in `nx-rust/test/group-run.spec.ts`
- [x] Verify `pnpm nx test @convesoft/nx-rust --testPathPatterns=group-run.spec.ts`, lint, format, `zban check`, and CI on the pull request pass

Done when: `group-run.spec.ts` passes regardless of parallel Cargo failure order and CI on the pull request is green.

## Summary of Changes

Updated `nx-rust/test/group-run.spec.ts:212-234` to match either `` `breakable` and `scripted` `` or `` `scripted` and `breakable` `` in the parallel-Cargo failure message, matching the fix already applied to `batch-runs.spec.ts` in `nxr-7gm46w`.

- Checks run: `pnpm nx test @convesoft/nx-rust --testPathPatterns="group-run|cargo-invocation" --skip-nx-cache`, `pnpm nx lint @convesoft/nx-rust`, `pnpm nx format:check --all`, `zban check`, and CI on the pull request.
