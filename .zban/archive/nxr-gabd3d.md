---
title: Run one cargo call per environment dump in batch-runs and pre-warm the workspace-tests and batch-groups builds
status: done
type: task
parent: nxr-e2z8sz
blocked_by:
  - nxr-4sr6hd
  - nxr-yfh7zh
  - nxr-qkxcmm
  - nxr-h411yj
  - nxr-krddfp
  - nxr-5hzxra
created_at: 2026-11-20T16:38:27Z
closed_at: 2026-11-21T18:12:10Z
---

Goal: the environment-dump tests of `batch-runs.spec.ts` keep every way of running and stop paying for crates, doctests and a test runner that the dumps do not need, and `workspace-build.spec.ts` and `batch-runs.spec.ts` reuse a pre-warmed `target/` (`VER-BATCHING`). No `VER-` item changes.

Context: from the maintainer's audit of the test suites on 20 November 2026, measured at 9d3430a: `nx-rust/test/batch-runs.spec.ts` took 116.2 s for 27 tests, of which the three `environmentDumps` tests took 50.5 s (lines 502-570 at 33.77 s, 572-613 at 10.81 s, 771-795 at 5.91 s). `batch-groups` has five library crates under `workspace-build`, so each of the 40 `dumpsOfRuns` invocations runs three cargo commands (`test --workspace --no-run`, `test --workspace --tests` with the Node `test-runner.js`, `test --workspace --doc` with rustdoc) and a forced recompile of `build.rs`. `nx-rust/test/workspace-build.spec.ts` took 44.6 s for 17 tests, each compiling the six crates of `workspace-tests` cold. The issue waits for the issues that change `batch-runs.spec.ts`, `dotenv-equivalence.spec.ts` and the batch executor, and for nxr-krddfp, whose helper for a template `target/` it reuses.

- [x] Reduce the `environmentDumps` overlay to the crate `indep` alone, as a library: each run still makes the three test calls of a whole-workspace test, which now compile one crate (one call is not possible; see the summary)
- [x] Keep all 11 `waysOfRunning`: the maintainer decided on 20 November 2026 that the matrix is not narrowed
- [x] Check whether the template-`target/` helper of nxr-krddfp helps `workspace-tests` and `batch-groups`: it does not, since neither has a third-party crate; not added
- [x] Show that the dump tests still fail when a batch and a single run differ in a variable, and give the timings before and after

Done when: both specs pass with unchanged assertions, the timings are reported, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Summary of Changes

- `nx-rust/test/batch-runs.spec.ts`: the `environmentDumps` overlay now removes the other six crates of `batch-groups` and `indep/tests/it.rs`, and writes a `Cargo.lock` that lists only `indep`. `indep` stays a library. Every run still makes the three whole-workspace steps (`--no-run`, `--tests` through the test runner, `--doc`), but on one crate, and rustdoc runs on one library that has no doctests. All 11 `waysOfRunning` stay, and no assertion changed.
- `nx-rust/test/harness/fixture-builds.ts`: the `warmBuilds` comment now says why `batch-groups` and `workspace-tests` are not in the table.
- Evidence: I added a temporary variable to the environment that the batch executor builds (`NX_RUST_TEMP_PROBE=batch`, in `src/executors/batch.ts`) and did not commit it. All six tests that use `environmentDumps` then failed in `expectOneEnvironment` at `expect({ name, env: without(dumped) }).toEqual({ name, env: without(first[1]) })`, with `+ "NX_RUST_TEMP_PROBE": "batch"` in the batched run's dump. Those six include the three tests the audit named.
- Timings, each spec run alone (`berth --exclusive`, `jest --json`): `batch-runs.spec.ts` went from 89.2 s to 78.0 s. The six dump tests went from 47.5 s to 37.7 s; the largest went from 30.5 s to 25.0 s and the root `.env` test from 7.4 s to 5.5 s. `workspace-build.spec.ts` is unchanged at 28.2 s. Most of what is left is the 40 Nx processes. The audit's figures (116.2 s and 44.6 s) were measured at 9d3430a; earlier issues of this package had already lowered both before this one started.

## Decisions made

- Accepted by the orchestrator: `indep` stays a library rather than becoming a binary with a `src/main.rs`. As a binary, its test depends on a staged `build`, which adds a task and a cargo call to every run, so a run still makes three cargo calls. Also, its build script would write its dump last in the `--tests` step, whose environment includes the runner's per-step `NX_RUST_TEST_RECORD`. That would fail `expectOneEnvironment` unless `perCommand` were widened, which would change the assertion. As a library, the build script writes its dump last in the doctest step, as it did before.
- Accepted by the orchestrator: `batch-groups` and `workspace-tests` are not added to `warmBuilds`. Neither fixture has a third-party crate. After `cargo clean -p` of their members, the template holds only `.rustc_info.json` and Cargo's lock files: I checked this with a build and `cargo test --no-run` of each fixture. Keeping the workspace's own crates in the template would go against the helper's rule that a copy compiles every crate of its own workspace.

Checks run: `pnpm nx run-many -t build lint test` (80 suites, 2100 passed) and `pnpm nx format:check --all`, both passing. `batch-runs.spec.ts` also passes as CI runs it (`env -u CLAUDECODE … CI=true GITHUB_ACTIONS=true`). `zban check` passes. Mara is unchanged.
