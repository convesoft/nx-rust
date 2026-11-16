---
title: Add the nextest runner with doctests
status: done
type: feature
priority: high
parent: nxr-m3k3w8
created_at: 2026-11-12T18:20:01Z
closed_at: 2026-11-16T16:43:06Z
---

Goal: `testRunner = "nextest"` runs a group's tests through one nextest run and the doctests through `cargo test --doc`.

Implements `REQ-TEST-RUNNER`, `REQ-DOCTESTS`, `DES-TEST-PHASES` and steps 3 to 5 of `DES-TEST-RUN` (`nx-rust/docs/testing.mara.md`). Checked by `VER-TESTING`.

- [x]- [ ] The `testRunner` option in plugin options and workspace metadata
- [x]- [ ] One `cargo nextest run` per group, with results mapped to crates
- [x]- [ ] Doctests as a second step, failing the crate's task when they fail
- [x]- [ ] The `profile` option on both steps, as `DES-PLUGIN-OPTIONS` maps it for the nextest runner (`EVD-NEXTEST-CARGO-FLAGS`)
- [x]- [ ] Build and run as separate phases inside the executor
- [x] Pass the workspace's runner to the inputs as `InputSettings.testRunner` (`nx-rust/src/graph/inputs.ts`, through `configureCaching` in `caching.ts`), which gives a `test` that nextest runs the workspace's `.config/nextest.toml` as an input ("Tool configuration" in `DES-INPUTS`), with its `VER-CACHE-KEYS` row in `nx-rust/test/cache-keys.spec.ts` (done in nxr-fy4t4k once nxr-xyq7c8 read `testRunner`: `inputSettings` in `nx-rust/src/graph/projects.ts`)
- [x]- [ ] Count cargo-nextest as needed in `init`'s table of tools (`nx-rust/src/tools/optional-tools.ts`) where a workspace uses the nextest runner, with the fixture for that row that `VER-SETUP` asks for
- [x]- [ ] Apply the repository's nextest configuration as a plain `cargo nextest run` does ("nextest's configuration" in `DES-TEST-RUN`): no `--profile` and no `--ignore-default-filter`; the plugin's tool configuration file (`--tool-config-file nx-rust:<file>`) sets only `junit.path` of `[profile.default]`, to a file in a folder of the plugin's own; where nextest exits with 100 and that report is missing, every task of the group fails with the message of `DES-DIAGNOSTICS`; each task's output holds nextest's lines on tests run and skipped and the number of its crate's tests in the report; the nextest case of `VER-TESTING`
- [x]- [ ] Give a `test` that nextest runs every variable whose name starts with `NEXTEST_` as an input, printed by the toolchain command as the `CARGO_PROFILE_` and `CARGO_TARGET_` variables are (`DES-INPUTS`), with the `VER-CACHE-KEYS` row

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

- [x]- [ ] Under `workspace-build`, the nextest step of `DES-TEST-RUN` ("Under `workspace-build`"): `cargo nextest run --workspace` with the filterset `package(=a) | package(=b)` of the group's packages and `--no-tests=pass`, without the selecting runner, followed by the doctest step that the `cargo` runner's groups already run (`readDoctestStep` in `nx-rust/src/executors/test-steps.ts`), and the nextest case of "Tests under `workspace-build`" in `VER-BATCHING` (moved from nxr-8f9dz2, which implemented the `cargo` runner's steps)


## Summary of Changes

- `testRunner = "nextest"` (already read from the plugin options and `[workspace.metadata.nx]`) now reaches the executor through the `test` target's metadata. A group that selects the whole workspace runs `cargo nextest run --workspace --no-fail-fast --no-tests=pass --tool-config-file nx-rust:<file> -E 'package(=a) | package(=b)'` (split into `-E` arguments of at most 64 KiB), then `cargo test --workspace --doc --no-fail-fast`. The profile goes to nextest as `--cargo-profile` and to the doctests as `--profile`. A group of one crate (own feature set) runs `cargo nextest run --no-tests=pass -p <spec>` and `cargo test -p <spec> --doc`. nextest groups need no host triple and are not split by a runner the user configured.
- Each task's result comes from nextest's status (0, 100 test failed, 101 build failed, anything else fails every task) and the tests of its package in the JUnit report (`nx-rust/src/executors/nextest.ts`). A missing report after 100 fails every task with the `DES-DIAGNOSTICS` message about `junit.path`. A report that contradicts the status, cannot be read or names a package outside the group fails every task. Each task shows nextest's lines for its own tests, the lines on the whole run and the number of its crate's tests in the report.
- The tool configuration sets only `junit.path` of `[profile.default]`, with no `--profile` and no `--ignore-default-filter`.
- `NEXTEST_` variables go into the toolchain command of a `test` that nextest runs. init counts cargo-nextest as needed per workspace that uses nextest, and a missing nextest fails the task before cargo runs.
- Knowledge: `DES-TEST-RUN` (one-crate groups, configured runner, filterset split, report reading, how the runner reaches the key), `DES-TEST-PHASES` (provisional: nextest's build and run share one command), new `EVD-NEXTEST-RUNNER-STEPS`; the status notes of testing, execution, configuration and targets.

Checks run on the final head:
- `NX_DAEMON=false pnpm nx run-many -t build lint test --skip-nx-cache` on Cargo 1.100.0 with cargo-nextest 0.9.152 on PATH: 58 suites, 1797 passed, 1 todo (after merging the local main).
- `pnpm nx format:check --all`.
- `pnpm nx e2e nx-rust-e2e --skip-nx-cache` without nextest: 27 passed on Cargo 1.100.0 and 27 on 1.91.0 (private RUSTUP_HOME).
- `nextest-runs.spec.ts` and `nextest-steps.spec.ts` on 1.91.0 with the real nextest: 21 passed.
- `mara schema validate`; `mara project validate` (valid, evaluation complete); `zban check`.


## Review round (16 November 2026)

- An incomplete run no longer caches success. nextest exits with 100 both where a test failed and where a global timeout, a signal or an interrupt ended the run, and the report holds only tests that ran. After 100 the group runs `cargo nextest list --message-format json` with the run's selection. A task passes only where every listed test of its crate is in the report as run and passed, and fails with a "run was not complete" message otherwise. Exit 0 proves a complete run (nextest's source). `--no-fail-fast` wins over the profile's `fail-fast` and `max-fail`.
- Setup scripts: `@setup-script:<id>` suites are read. A failed one, or status 105, fails every task naming the script, and a passed one decides nothing. `@stress-N` suffixes are stripped, and any other kind of suite fails every task naming it.
- The key of a `test` under nextest holds `cargo nextest --version`, or `cargo-nextest: not found`; other keys are unchanged. The harness's `taskCalls` leaves that call out.
- Knowledge: `DES-TEST-RUN`, `DES-INPUTS`, `DES-DIAGNOSTICS` (three rows), `EVD-NEXTEST-RUNNER-STEPS`, `VER-TESTING`, `VER-CACHE-KEYS`.

Checks on the final head:
- After merging the local main, which brought the hakari and cargo strategies, the nextest run, its list and the doctests also pass the cargo strategy's `--config 'resolver.feature-unification="workspace"' -Zfeature-unification`, as every command that compiles does there.
- `NX_DAEMON=false pnpm nx run-many -t build lint test --skip-nx-cache` with cargo-nextest 0.9.152 on PATH: 60 suites, 1860 passed, 5 skipped (main's checks that need cargo-hakari), 1 todo.
- `pnpm nx format:check --all`.
- e2e without nextest: 27 passed on Cargo 1.100.0 and 27 on 1.91.0.
- The nextest specs on 1.91.0: 32 passed.
- `mara schema validate`; `mara project validate` (valid, evaluation complete); `zban check`.
