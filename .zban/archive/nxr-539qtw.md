---
title: Add the test mode input
status: done
type: feature
priority: high
parent: nxr-m3k3w8
blocked_by:
  - nxr-jb6g5y
created_at: 2026-11-12T18:20:01Z
closed_at: 2026-11-16T19:51:49Z
---

Goal: the mode (`full` or `affected:<baseline commit>`) is part of every `test` cache key.

Implements `REQ-TEST-MODE-KEY` and `DES-TEST-MODE` (`nx-rust/docs/testing.mara.md`). Checked by `VER-TESTING` and `VER-CACHE-KEYS`. Depends on what the Nx 24 input spike found about runtime inputs.

- [x] The plugin command that prints the mode, which reads the baseline's commits from cargo-affected's database and never starts cargo-affected (`DES-TEST-MODE`, `EVD-CARGO-AFFECTED-COST`)
- [x] The runtime input on the `test` target
- [x] The mode rule of `DES-TEST-MODE`: `NX_RUST_TEST_MODE`, the default per environment, the fallback without a baseline, and `--affectedTests=false`
- [x] Matrix rows for mode and baseline changes

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Summary of Changes

- A `test` in a workspace with `affectedTests` has a runtime input, the plugin's script `print-test-mode.js`, that prints `full`, `affected:<baseline commits>` or `invalid NX_RUST_TEST_MODE=<value>` (`DES-TEST-MODE`, `REQ-TEST-MODE-KEY`). It reads the commits of `target/affected/coverage.db` with `node:sqlite` only through an immutable, read-only open, which writes nothing, and prints `full` where a `-wal` file lies beside the database before or after the read, or the database file changed between the two looks (the review's fix, decided by the control plane). It never starts cargo-affected, cargo or git.
- The mode rule (`NX_RUST_TEST_MODE`, the default per environment from a copy of Nx 24.0.6's `isCI`, `full` without a usable baseline) is shared by the command and the executor. The executor fails an invalid value before cargo runs, alone and in a batch, and says at the top of each task's output which suite runs and why. Selection itself is nxr-tabkjx: in affected mode the full suite still runs, under the affected key.
- Decisions recorded in `DES-TEST-MODE`, with the new `EVD-TEST-MODE-READING`; a "Test mode" row in the table of `DES-INPUTS` and in the guide's table; the status note of the testing page and a sentence there on a baseline with a `-wal` file. `DES-TEST-MODE` names, under `RISK-SUBSET-AS-FULL`, the race between hashing and the executor's own reading of the baseline, which nxr-tabkjx must guard before it selects.
- Rejected: any read-only open that is not immutable, also where a `-wal` file exists (a collection closing in between, or a baseline restored with `-wal` but without `-shm`, left new `-wal` or `-shm` files), loading Nx's `isCI` in the command (costs more than the command), filtering the commits by the current fingerprint (would mean hashing what cargo-affected hashes).

Checks run on the final merged head, after the review's fixes: `NX_DAEMON=false pnpm nx run-many -t build lint test --skip-nx-cache` (63 suites, 1911 passed, 18 skipped for missing nextest and cargo-hakari, 3 todo); `pnpm nx format:check --all`; `test-mode.spec.ts` (21 passed, with cargo-nextest on PATH) and `cache-keys.spec.ts` (114 passed, 8 skipped and 1 todo for pinned toolchains) on Cargo 1.91.0; `test-mode.spec.ts` with nextest on 1.100.0 (21 passed); `pnpm nx e2e nx-rust-e2e --skip-nx-cache` on Cargo 1.100.0 (27 passed) ran on the head before the fixes, and the control plane runs it on both Cargo versions; `mara schema validate`, `mara project validate` (valid, complete evaluation), `zban check`.
