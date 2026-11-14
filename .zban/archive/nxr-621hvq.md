---
title: Nx can store cargo test's executable under build's key, and run integration tests against build's executable
status: done
type: bug
priority: high
parent: nxr-9y4eh8
discovered_from: nxr-1q1f0n
created_at: 2026-11-14T17:08:55Z
closed_at: 2026-11-14T17:55:29Z
---

Goal: on `main`, a crate's `build` and `test` never overlap where `cargo test` replaces the executables that `build` declares, so that Nx neither stores `cargo test`'s executable under the key of `build` nor stores a `test` result for which the integration tests ran `build`'s executable (`GOAL-TRUSTED-CACHE`).

Context: for a crate with a `bin` target and an integration test, `cargo test` replaces the executable in the artifact directory with one built with what dev-dependencies turn on and with the `test` profile, even when its units are fresh, and `cargo build` puts its own back. Nx copies a task's declared outputs some milliseconds after its process ends (`DES-OUTPUTS`), and `CARGO_BIN_EXE_<bin>` names that same file, which the tests run after cargo has released its lock. When Nx runs `a:build` and `a:test` in parallel, the stored `build` entry can hold the test flavour, and the tests can run the build flavour. The research of 14 November 2026 for nxr-1q1f0n measured both. The maintainer chose that `test` depends on the same crate's `build` in the crates concerned, with an executor guard where a configuration removes the edge; the decision and the rule are recorded in Mara with the fix.

- [x] Establish the rule that tells from the `cargo metadata --no-deps` report which crates need the edge, by experiment, and record it in `DES-TARGETS` and `DES-OUTPUTS`
- [x] Infer `dependsOn` from `test` to the same project's `build` for those crates, under the names that `targetNames` gives them
- [x] Fail `test` before cargo runs where its task graph holds the same crate's `build` without the edge, with a message in the style of `DES-DIAGNOSTICS`
- [x] Confirm that `bench` (`parallelism: false`) cannot overlap a `build`, and document what `run` does to the executable
- [x] Tests with a real cargo and Nx: the edge per shape of the rule, the order of the cargo calls, the stored `build` entry, the passing integration test, the guard, renamed targets; each fails with the edge or the guard removed
- [x] Measure wrong `build` entries and failing tests with and without the edge, and record an evidence item
- [x] `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e` (also on Cargo 1.91.0), `mara schema validate`, `mara project validate` and `zban check` pass

Done when: the edge and the guard are implemented as `DES-TARGETS` describes, the tests above pass and fail without them, and the checks pass.

## Summary of Changes

- Rule, from an experiment on cargo 1.100.0 and 1.91.0 with one crate per shape (`EVD-CARGO-ARTIFACT-WRITERS`): a target of kind `bin` and a target of kind `test` or `bench` whose `test` flag is on, whatever the `required-features` of either, stated once in `DES-TARGETS` and implemented as `testReplacesExecutables` (`nx-rust/src/graph/targets.ts`); `CargoTarget` gains the report's `test` flag.
- The inferred `test` of such a crate depends on the same project's `build` under the names that `targetNames` gives, cached or not, and carries `metadata.cargo.waitsForBuild`. The `test` executor fails before cargo where the task graph holds that `build` with no path between the two (`checkBuildOrder` in `nx-rust/src/executors/task.ts`); the `targetDefaults` guard's message for a lost `dependsOn` names the new reason.
- `bench` cannot overlap a `build`: Nx's `canBeScheduled` starts nothing beside a `parallelism: false` task; six runs beside builds, tests, checks and lints showed no overlap. `run` stays unordered; the targets page says what it does to the executable.
- Tests: fixture `binary-tests`; `targets.spec.ts` (edge per shape, `nx run`, `nx affected`, `--exclude-task-dependencies`, configurations, renamed targets); `test-after-build.spec.ts` (no `cargo test` while `build`'s cargo is held, integration test passes, artifact directory then holds the test's executable, cache hit of `build` restores what `cargo build -p` writes, `nx run app:test` runs `build` first, the guard with default and renamed targets); a case in `target-defaults.spec.ts`. With the edge removed 10 of these tests fail; with edge and guard removed all five run tests fail; with the guard removed the two guard tests fail; the `targetDefaults` case fails without the edge.
- Measured with the real implementation (six crates, warm build directory, empty Nx cache and `.nx`, default parallelism, 3 × 6 runs): without the edge 32 of 108 wrong `build` entries and 1 of 108 failed tests, with it 0 and 0; one crate whose test waits 1.5 s: 8 of 8 failed without, 0 of 8 with.
- Checks run on the head after merging the local `main` at 49059ef: `pnpm nx run-many -t build lint test` (38 suites, 1172 passed, 1 todo), `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e` on cargo 1.100.0 and on 1.91.0 through a private `RUSTUP_HOME` (26 passed each), `test-after-build.spec.ts` also on 1.91.0, `mara schema validate`, `mara project validate` (`valid: true`, evaluation complete, no errors or warnings), `zban check`.
- Filed: nxr-ew8kb3 (same-named executables), nxr-gyyhdj (a `targetDefaults` entry that repeats the lockfile dependency as an object is reported as replacing it).

Rejected approaches: none in code; the options the maintainer did not take are in `ADR-TEST-AFTER-BUILD`.
