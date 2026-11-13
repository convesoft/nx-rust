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
- [x] Pass the workspace's runner to the inputs as `InputSettings.testRunner` (`nx-rust/src/graph/inputs.ts`, through `configureCaching` in `caching.ts`), which gives a `test` that nextest runs the workspace's `.config/nextest.toml` as an input ("Tool configuration" in `DES-INPUTS`), with its `VER-CACHE-KEYS` row in `nx-rust/test/cache-keys.spec.ts` (done in nxr-fy4t4k once nxr-xyq7c8 read `testRunner`: `inputSettings` in `nx-rust/src/graph/projects.ts`)
- [ ] Count cargo-nextest as needed in `init`'s table of tools (`nx-rust/src/tools/optional-tools.ts`) where a workspace uses the nextest runner, with the fixture for that row that `VER-SETUP` asks for

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
