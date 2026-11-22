---
title: Add a test-target selector option to the test target
status: todo
type: feature
parent: nxr-h52ghk
blocked_by:
  - nxr-tjxcvx
discovered_from: nxr-pt464b
created_at: 2026-11-22T10:39:28Z
---

Cites: `DES-TARGETS`, `DES-TARGET-COMMANDS`, `DES-PLUGIN-OPTIONS`, `DES-BATCH`, `DES-TEST-RUN`, `DES-TEST-MODE`, `DES-INPUTS`, `REQ-TEST-RUNNER`, `RISK-SUBSET-AS-FULL`.

In `mara`, running a single integration test binary (for example `cargo test --package mara --test performance --release`) cannot be expressed through the inferred `test` target, forcing a hand-written target.

Note: blocked by `nxr-tjxcvx` to avoid concurrent edits to `nx-rust/src/executors/command.ts` and `group-run.ts`.

- [ ] Design and specify the test-target selector option in Mara (`DES-TARGETS`, `DES-TARGET-COMMANDS`, `DES-PLUGIN-OPTIONS`, `DES-BATCH`, `DES-TEST-RUN`, `DES-TEST-MODE`) and user docs (`nx-rust/docs/targets.mara.md`, `testing.mara.md`, `configuration.mara.md`), keeping the option surface minimal and orthogonal
- [ ] Implement the option across executor schema (`nx-rust/src/executors/cargo/schema.json`), option validation, `cargo test` (`--test <name>`), and `cargo nextest` (`--test <name>`, skipping `cargo test --doc` when an integration test binary is selected)
- [ ] Handle `workspace-build` batching/grouping and `NX_RUST_TEST_MODE=affected` safely so tasks with different selectors never share an incompatible cargo call and a subset result is never stored under a full-suite key (`RISK-SUBSET-AS-FULL`)
- [ ] Add unit and real-`cargo` (plus `nextest` where available) tests for single runs, batches, cache-key separation from the full `test` target, and `affected` mode interaction

Done when: a crate can run a single integration test binary through the `test` target (including with `--profile release` and both `cargo` and `nextest` runners), and `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e`, `pnpm nx format:check --all`, `mara schema validate`, `mara project validate`, `zban check` and CI pass.
