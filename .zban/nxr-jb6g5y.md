---
title: Add the nextest runner with doctests
status: todo
type: feature
priority: high
parent: nxr-m3k3w8
created_at: 2026-11-12T18:20:01Z
---

Goal: `testRunner = "nextest"` runs a group's tests through one nextest run and the doctests through `cargo test --doc`.

Implements `REQ-TEST-RUNNER`, `REQ-DOCTESTS`, `DES-TEST-PHASES` and steps 3 to 5 of `DES-TEST-RUN` (`nx-rust/docs/testing.mara.md`). Checked by `VER-TESTING`.

- [ ] The `testRunner` option in plugin options and workspace metadata
- [ ] One `cargo nextest run` per group, with results mapped to crates
- [ ] Doctests as a second step, failing the crate's task when they fail
- [ ] The `profile` option on both steps, as `DES-PLUGIN-OPTIONS` maps it for the nextest runner (`EVD-NEXTEST-CARGO-FLAGS`)
- [ ] Build and run as separate phases inside the executor
- [ ] Count cargo-nextest as needed in `init`'s table of tools (`nx-rust/src/tools/optional-tools.ts`) where a workspace uses the nextest runner, with the fixture for that row that `VER-SETUP` asks for

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
