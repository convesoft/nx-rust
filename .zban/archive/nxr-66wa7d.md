---
title: Run graph-time cargo with RUSTUP_AUTO_INSTALL=0
status: done
type: task
priority: high
parent: nxr-w9qa5f
discovered_from: nxr-1ydrfd
created_at: 2026-11-13T14:30:22Z
closed_at: 2026-11-13T15:00:09Z
---

Goal: graph creation installs no toolchain. The folders its cargo calls start in are already as `DES-METADATA-REPORT` names them.

Implements `ADR-GRAPH-NO-TOOLCHAIN-INSTALL` and the last paragraph of `DES-METADATA-REPORT` (`nx-rust/docs/workspaces.mara.md`). Checked by the graph-creation cases of a missing pinned toolchain in `VER-SETUP`. `EVD-RUSTUP-MISSING-TOOLCHAIN` has what rustup prints.

- [x] Set the variable in `runCargoForGraph` (`nx-rust/src/cargo/run-cargo.ts`) for its child only, not in `process.env`
- [x] Tests. The harness sets `RUSTUP_AUTO_INSTALL=0` for every command (`nx-rust/test/harness/environment.ts`), so a test that checks the plugin sets it has to remove it from the environment, and should then pin no missing toolchain, so that a failure cannot download one

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Summary of Changes

- `runCargoForGraph` (`nx-rust/src/cargo/run-cargo.ts`) runs cargo with `{ ...process.env, RUSTUP_AUTO_INSTALL: "0" }`, so the variable reaches the child only. The declaration carries `// @mara implements DES-METADATA-REPORT`; `mara related DES-METADATA-REPORT` lists it as `implemented_by`.
- The test cargo wrapper records `RUSTUP_AUTO_INSTALL` with each call (`null` where unset), read through the new `CargoWrapper.callsWithEnv(root)`. `calls(root)` returns the same `{ cwd, args }` as before, so existing tests are unchanged.
- `nx-rust/test/missing-toolchain.spec.ts` covers the graph-creation cases of `VER-SETUP` with real cargo and Nx graph creation. (1) A workspace that pins a missing toolchain (`1.92.0`) fails graph creation with a message naming `rust/Cargo.toml` and rustup's `toolchain '1.92.0-…' is not installed`. (2) In `vendored-crate` with a member and a path dependency without a project each pinning it, the graph is created and all three cargo calls start in `rust/` with `RUSTUP_AUTO_INSTALL=0`; a positive control shows cargo fails in each pinned folder. (3) With the variable removed from Nx's environment and nothing missing pinned, every graph call still has `0`, and a probe task's cargo has it unset. (4) In process, the child gets `0` while `process.env` stays without it. Cases 1 and 2 also check that `rustup toolchain list` is unchanged. The two cases with the pins run with the harness's `RUSTUP_AUTO_INSTALL=0`. They skip outside CI without rustup or with `1.92.0` installed.
- Mutation check: with the old `env: process.env`, cases 3 and 4 fail and cases 1 and 2 pass.
- Checked by hand: a cargo that is no rustup proxy (`/usr/bin/cargo`, Arch `rust` 1.99.1) reads a folder that pins the missing toolchain through the built `runCargoForGraph` without error.
- The task half of the row (tasks' cargo gets no setting) is checked with the probe executor only, because the plugin has no executor yet: follow-up nxr-maxy88.

Checks run: `pnpm nx run-many -t build lint test` (7 suites, 121 tests), `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e` (8 tests), `mara schema validate`, `mara project validate` (valid, evaluation complete, 0 errors, 0 warnings) and `zban check`. All passed. `rustup toolchain list` was the same before and after.
