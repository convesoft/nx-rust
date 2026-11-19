---
title: Add the coverage baseline target
status: done
type: feature
parent: nxr-m3k3w8
blocked_by:
  - nxr-tabkjx
  - nxr-3k3z1j
created_at: 2026-11-12T18:20:01Z
closed_at: 2026-11-17T10:16:50Z
---

Goal: a workspace-level target brings the coverage baseline up to date, and the docs show the main and pull request pipelines.

Implements `REQ-BASELINE` and `DES-BASELINE` (`nx-rust/docs/ci.mara.md`). Checked by `VER-TESTING`.

- [x] The collection target on the workspace project: `collect --diff`, or a full `collect` when there is no usable data or the threshold is exceeded
- [x] Collect with `--workspace --no-fail-fast`, the test runs' cargo arguments and git's `diff.relative`, into the database path that `DES-BASELINE` names (`EVD-CARGO-AFFECTED-REPORT`), and write the context record beside it (`DES-BASELINE`, `ADR-AFFECTED-BASELINE-CONTEXT`)
- [x] Before a full `collect`, remove `target/affected/coverage.db` with its `-wal` and `-shm` files, so that it starts from an empty database (`DES-BASELINE`, `EVD-COVERAGE-COLLECT-COST`)
- [x] Before every collection, full or `--diff`, remove the context record, and write the new one only after cargo-affected has ended successfully, so that a failed or interrupted collection leaves no record ("Order of writing" in `DES-BASELINE`); test the failure case of `VER-TESTING`
- [x] The threshold option
- [x] The optional switches listed in `DES-BASELINE`; collection sets no Cargo directory of its own unless the separate build directory switch is on
- [x] A worked CI example in `ci.mara.md`, which sets `CARGO_BUILD_JOBS` and `NEXTEST_TEST_THREADS` for the collection step and says how large the saved database gets (`EVD-COVERAGE-COLLECT-COST`)

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Summary of Changes

The workspace project of a workspace with `affectedTests` gets `coverage-baseline` (name provisional), run by the lockfile executor so it never joins a batch and is covered by `init`'s existing `targetDefaults` entry. It asks `cargo affected status` (with git's `diff.relative`) whether `collect --diff` can run, and runs a full `collect` into an empty database where the report shows no usable data, `status` fails, or the oldest collection is more than `fullCollectThreshold` (default 100) commits behind. It removes the context record (and, for a full collection, `coverage.db` with `-wal` and `-shm`) after `status` and before `collect`, and writes the record only after cargo-affected succeeded. The record is computed with the plugin's functions from the inputs of the workspace's `test` tasks, in the collection task's environment. Switches: `fullCollect`, `diffOnly`, `separateBuildDir` (`CARGO_BUILD_BUILD_DIR=target/affected/build`). A lock in `target/affected` keeps two collections of one checkout apart; the test executor reads the record again after `status` (same-commit collection in another context). Missing cargo-affected, cargo-nextest or llvm-tools fail the task with what to do; `init`'s table counts the llvm-tools component. `ci.mara.md` has a worked GitHub Actions example for main and pull requests. Decisions are in `DES-BASELINE` ("The target", "Choosing the collection", "The record's content", "Collection and the test runs") and `DES-TEST-RUN`.

Checks run on the merged head: `pnpm nx run-many -t build lint test` with the real cargo-affected, llvm tools and nextest on PATH (68 suites, 2,033 passed, 7 skipped, 1 todo); `pnpm nx format:check --all`; `pnpm nx e2e nx-rust-e2e` (27 passed); the changed specs on Cargo 1.91.0 (111 passed, 10 real-coverage cases skipped with their warning); `mara schema validate`, `mara project validate` (valid, evaluation complete, 0 errors, 0 warnings); `zban check`. There is no pull request; CI is not part of this hand-in.

Rejected: a dedicated executor (would change `init`'s entries everywhere); making the collection depend on the `test` tasks (orders one command only, and blocks `fullCollect` as the full run on main); reading the collection's cargo options from the `test` targets. Backlog: nxr-rhbpee, nxr-5pphav.


## Summary of the review fixes (19 November 2026)

- `--diff` runs only where the context record that is there before the collection can be read, is of version 2 and equals this collection's context in every field (`contextDifferences`, both directions). A missing, unreadable, old-version or different record gives a full collection into an empty database without `status`, with the reason; with `diffOnly`, nothing is collected and everything stays. Recorded in `DES-BASELINE` ("Choosing the collection", "Order of writing") and `ADR-AFFECTED-BASELINE-CONTEXT`; the CI guide says that a main pipeline whose context changes pays one full collection.
- The stale-lock takeover is atomic: lock files are created whole by hard link (fails where the name exists), and a stale lock is removed only by the holder of the takeover marker `target/affected/nx-rust-collect.lock.takeover`, after re-reading that the lock still names the dead process. A leftover marker fails a collection only where that collection also finds a stale lock (the takeover is refused, and both files are named); beside no lock, the collection takes the lock as usual and the marker stays, which is safe because a live taker then loses its creation and is refused (re-check of 19 November 2026). Recorded in `DES-BASELINE`, with the argument that two takers cannot both succeed.
- The CI guide says that a variable set only in `.env.test` makes every affected run take the full suite until the collection step gets the same value (nxr-rhbpee stays in the backlog).

Checks run: the reviewer's real-tool sequence (`REVIEW_MODE`) and the stand-in cases (record missing, unreadable, version 1, different, holding a dropped runtime input, equal; `diffOnly` in each; two takers in both orders; a leftover marker). `pnpm nx run-many -t build lint test` with `ca-env.sh` and the real tools: 68 suites, 2,038 passed, 7 skipped, 1 todo once `NEXTEST_TEST_THREADS` was unset; with it set, two existing cases of `nextest-runs.spec.ts` fail, because the variable overrides the fixture's `test-threads = 1` (backlog nxr-tcttks). `pnpm nx format:check --all`. `coverage-baseline.spec.ts` and `affected-coverage.spec.ts` on Cargo 1.91.0 (25 passed, 11 real-coverage cases skipped). `mara schema validate`, `mara project validate` (valid, complete, 0 errors, 0 warnings), `zban check`.
