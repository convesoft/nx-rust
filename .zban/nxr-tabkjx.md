---
title: Select affected tests inside the test target
status: todo
type: feature
parent: nxr-m3k3w8
blocked_by:
  - nxr-539qtw
  - nxr-hvw1rq
  - nxr-3qe5zj
created_at: 2026-11-12T18:20:01Z
---

Goal: with `affectedTests` on, a `test` task runs the selected tests, widened where coverage cannot see a change, and says what it did.

Implements `REQ-AFFECTED-TESTS`, `REQ-SELECTION-SAFETY` and steps 1 and 2 of `DES-TEST-RUN` (`nx-rust/docs/testing.mara.md`). Checked by `VER-TESTING`.

- [ ] The graph-time error for `affectedTests` without nextest, with a case in `nx-rust/test/init.spec.ts` in which `init` fails with it (`VER-SETUP`)
- [ ] Ask cargo-affected for the selection and read its report
- [ ] Add whole crates for `build.rs`, toolchain files, `.cargo/config.toml`, proc-macro source and non-Rust test inputs
- [ ] Pass the selection to nextest through a generated configuration file
- [ ] Report a fallback to the full suite with its reason
- [ ] Warn when cargo-affected is missing in a run in mode `full`
- [ ] `--affectedTests=false` and the per-crate opt-out (`DES-TEST-RUN`, `DES-PLUGIN-OPTIONS`); the graph-time error for `affectedTests = true` belongs to nxr-xyq7c8
- [ ] The task-time error for `--affectedTests=true` that `DES-DIAGNOSTICS` lists, for a single task and in a batch
- [ ] Count cargo-affected as needed in `init`'s table of tools (`nx-rust/src/tools/optional-tools.ts`) where a workspace has `affectedTests` on, with the fixture for that row that `VER-SETUP` asks for

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
