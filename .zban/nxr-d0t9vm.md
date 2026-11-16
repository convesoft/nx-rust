---
title: Add the coverage baseline target
status: todo
type: feature
parent: nxr-m3k3w8
blocked_by:
  - nxr-tabkjx
  - nxr-3k3z1j
created_at: 2026-11-12T18:20:01Z
---

Goal: a workspace-level target brings the coverage baseline up to date, and the docs show the main and pull request pipelines.

Implements `REQ-BASELINE` and `DES-BASELINE` (`nx-rust/docs/ci.mara.md`). Checked by `VER-TESTING`.

- [ ] The collection target on the workspace project: `collect --diff`, or a full `collect` when there is no usable data or the threshold is exceeded
- [ ] Collect with `--workspace --no-fail-fast`, the test runs' cargo arguments and git's `diff.relative`, into the database path that `DES-BASELINE` names (`EVD-CARGO-AFFECTED-REPORT`), and write the context record beside it (`DES-BASELINE`, `ADR-AFFECTED-BASELINE-CONTEXT`)
- [ ] Before a full `collect`, remove `target/affected/coverage.db` with its `-wal` and `-shm` files, so that it starts from an empty database (`DES-BASELINE`, `EVD-COVERAGE-COLLECT-COST`)
- [ ] Before every collection, full or `--diff`, remove the context record, and write the new one only after cargo-affected has ended successfully, so that a failed or interrupted collection leaves no record ("Order of writing" in `DES-BASELINE`); test the failure case of `VER-TESTING`
- [ ] The threshold option
- [ ] The optional switches listed in `DES-BASELINE`; collection sets no Cargo directory of its own unless the separate build directory switch is on
- [ ] A worked CI example in `ci.mara.md`, which sets `CARGO_BUILD_JOBS` and `NEXTEST_TEST_THREADS` for the collection step and says how large the saved database gets (`EVD-COVERAGE-COLLECT-COST`)

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
