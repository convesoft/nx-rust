---
title: Make the hold check of test-after-build.spec.ts able to fail without the test-on-build dependency
status: done
type: bug
parent: nxr-e2z8sz
discovered_from: nxr-11vr5k
created_at: 2026-11-20T18:24:46Z
closed_at: 2026-11-21T09:46:58Z
---

Goal: the two cases "runs its test only once its build has ended…" in `nx-rust/test/test-after-build.spec.ts` fail when the plugin no longer makes `test` wait for `build` (`DES-TARGETS`, checked by `VER-TARGETS`).

Context: found in nxr-11vr5k on Nx 24.0.6. With a temporary mutation that made `testBuilds` in `nx-rust/src/graph/targets.ts` return `[]`, so that there is no dependency and no guard, both cases still passed: in the default run (`run-many -t build test -p app`, batches preferred), Nx did not start `app:test` while the held `app:build` waited, not within 8 s or 20 s. The `early` check and the later assertions on the order of calls never saw the missing dependency. Other cases of the file did fail under the mutation. With `--batch=false` added, Nx started `app:test` before the first 50 ms poll of `hold.held()`.

- [x] Decide how the cases should show the ordering, for example a run with per-task scheduling (`--batch=false`) beside the default run, or an assertion on the task graph, without changing what `VER-TARGETS` says
- [x] Show with the mutation above that both cases then fail

Done when: both cases fail under the mutation, pass without it, and `pnpm nx run-many -t build lint test` passes.

## Summary of Changes

The two cases "runs its test only once its build has ended…" in `nx-rust/test/test-after-build.spec.ts` now run the held `run-many -t build test -p app` with `--batch=false`. In that run Nx starts `app:test` as soon as nothing orders it after `app:build`, so the `early` check observes a missing dependency. Run task by task, every build that `app:test` waits for runs its own `cargo build` call. The order assertion therefore now accepts one or more build calls of the group's command, followed by the test calls. The batched default run is still exercised by the other cases of the file. This adds no run: the existing run changes mode.

Mutation run (not committed): `testBuilds` call in `nx-rust/src/graph/targets.ts` replaced by `[]`. Both cases failed at `expect(early).toBe(false)` (`Expected: false`, `Received: true`). The other five cases of the file that cover the dependency or the guard also failed (7 failed, 1 passed).

Checks run: `pnpm nx test nx-rust --testPathPatterns=test-after-build --skip-nx-cache` (8 passed), `pnpm nx run-many -t build lint test` (passed), `pnpm nx format:check --all` (passed), `zban check`. The CI-variant run is not needed, because the spec sets no `CI`, `GITHUB_ACTIONS` or agent variables.

## Decisions made

- The ordering is shown with per-task scheduling (`--batch=false`) on the existing held run, not with an extra run or a task-graph assertion. This keeps the cost unchanged. It checks the runtime behaviour that `VER-TARGETS` describes, which names no batch mode, so neither `VER-TARGETS` nor `DES-TARGETS` changes.
