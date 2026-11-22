---
title: Shard the unit test suite across parallel CI jobs
status: done
type: task
parent: nxr-m7sbwe
created_at: 2026-11-22T00:24:24Z
closed_at: 2026-11-22T00:27:23Z
---

Goal: run the unit test suite of `@convesoft/nx-rust` across 4 parallel GitHub Actions jobs behind the required check `Build, lint, test and format`, cutting CI wall time roughly in half without changing branch protection or weakening any test.

Context: in `.github/workflows/ci.yml`, the single `check` job runs build, lint, format, `zban check` and all 80 unit/integration test suites on one `ubuntu-latest` runner (~10–12 minutes). `e2e` already splits into `e2e-stable` and `e2e-msrv` behind an aggregator job using `.github/actions/e2e/action.yml`. Jest 30's default `TestSequencer.prototype.shard` shards by SHA-1 hash of file count rather than runtime, which can pile multiple 60–90 s specs into one shard.

- [x] Override `shard()` in `nx-rust/jest.sequencer.cjs` to deterministically balance the heaviest spec files across shards (snake-draft order over `heaviest` followed by remaining files by descending size and path) while keeping `sort()` longest-first
- [x] Add unit tests in `nx-rust/test/jest-sequencer.spec.ts` verifying partition completeness (no duplicates, no omitted suites), order independence, balanced distribution of `heaviest` across shards, and longest-first `sort()`
- [x] Add `.github/actions/unit-tests/action.yml` for the shared Rust/Node/optional-tool setup and sharded `pnpm nx test @convesoft/nx-rust --skip-nx-cache --shard=<shard>` run
- [x] Split `.github/workflows/ci.yml`'s `check` job into `build-lint-format` and four explicit `test-1`..`test-4` jobs behind the required aggregator job `check` (`Build, lint, test and format`) with `if: always()` checking every job's result is `success`
- [x] Update `AGENTS.md` to note that `build-lint-format` and the sharded test jobs run behind `Build, lint, test and format`
- [x] Verify all checks locally (`pnpm nx run-many -t build lint`, `jest-sequencer.spec.ts`, all 4 shards partition the full suite with `--listTests`, `pnpm nx format:check --all`, `zban check`) and confirm CI passes on the pull request

Done when: all local checks pass, every shard runs in CI and passes behind `Build, lint, test and format`, and `End-to-end tests` passes on the pull request.

## Summary of Changes

- `nx-rust/jest.sequencer.cjs`: overrode `shard(tests, { shardIndex, shardCount })` to deterministically order the 25 heaviest spec files first and the remaining suites by descending file size and relative POSIX path, then assign them across shards in snake-draft order while keeping `sort()` longest-first.
- `nx-rust/test/jest-sequencer.spec.ts`: added 9 pure unit tests verifying partition completeness across 1–5 shards, input-order independence, snake-draft distribution of `heaviest`, synthetic-path handling, and longest-first `sort()`.
- `.github/actions/unit-tests/action.yml`: extracted the shared pnpm, Node, Rust toolchain (`stable` + `1.91.0`), optional-tool (`cargo-nextest`, `cargo-hakari`, `wasm-bindgen`, `cargo-affected`) setup and sharded `pnpm nx test @convesoft/nx-rust --skip-nx-cache --shard=<shard>` invocation into a local composite action.
- `.github/workflows/ci.yml`: split `check` into `build-lint-format` and four explicit `test-1`..`test-4` jobs behind the required aggregator job `check` (`Build, lint, test and format`) with `if: always()` checking that every job's result is `success`, keeping branch protection unchanged.
- `AGENTS.md`: noted that `build-lint-format` and the sharded unit-test jobs run behind `Build, lint, test and format`.

Checks run locally:
- `pnpm nx run-many -t build lint --output-style=static`: passed (7 tasks, 0 warnings, 0 errors).
- `pnpm nx test @convesoft/nx-rust --skip-nx-cache --testPathPatterns=jest-sequencer`: passed (9 tests).
- Real Jest CLI `--shard=1/4`..`4/4 --listTests`: verified all 81 spec files partition cleanly (21, 20, 20, 20; 81 unique, 0 duplicates, 0 omissions) with top heaviest suites spread across all four shards.
- YAML syntax validation on `.github/workflows/ci.yml` and `.github/actions/unit-tests/action.yml`: passed.
- `pnpm nx format:check --all` and `zban check`: passed.
- Full sharded test runs and end-to-end runs are covered by CI on this pull request.


### Follow-up on the pull request: real CI timing profile + LPT bin-packing

- Replaced the 25-file static snake-draft list with real CI per-suite timing profiling and Longest Processing Time first (LPT) greedy bin-packing:
  - `nx-rust/jest.timings-reporter.cjs` (enabled in `nx-rust/jest.config.cts` only when `NX_RUST_JEST_TIMINGS_OUTPUT` is set) writes `{ "<relative posix path>": durationMs }` without altering Jest's default output.
  - `nx-rust/jest.sequencer.cjs` reads `NX_RUST_JEST_TIMINGS_FILE` and runs LPT bin-packing in `shard()` (falling back to median duration for newly added specs, and to the original 9-file `heaviest` list + file size on a cold cache) and orders recorded specs longest-first in `sort()`.
  - `.github/workflows/ci.yml` adds a lightweight `plan-shards` job that restores `jest-timings.json` once from `actions/cache` and passes the exact pinned JSON snapshot to `test-1`..`test-4` (preventing split-brain across shards); `check` merges the four shards' measured durations and saves the updated profile back to `actions/cache` with `continue-on-error: true`.
  - `.github/actions/unit-tests/action.yml` accepts the pinned `timings` input and emits the shard's measured `timings` output.
  - `nx-rust/test/jest-sequencer.spec.ts` expanded to 12 tests covering LPT bin-packing, median fallback for new specs, malformed-file fallback, timing-guided `sort()` and `TimingsReporter`.
- Re-verified locally: `pnpm nx run-many -t build lint --output-style=static`, `NX_RUST_JEST_TIMINGS_OUTPUT=... pnpm nx test @convesoft/nx-rust --skip-nx-cache --testPathPatterns=jest-sequencer` (12/12 passed, wrote `{"test/jest-sequencer.spec.ts":86}`), real Jest CLI `--shard=1/4`..`4/4 --listTests` with `NX_RUST_JEST_TIMINGS_FILE` (81 unique specs, loads 831s / 830s / 830s / 830s), YAML validation, `pnpm nx format:check --all` and `zban check`.
