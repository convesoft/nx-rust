---
title: Discover Cargo workspaces and load cargo metadata
status: done
type: feature
priority: high
parent: nxr-w9qa5f
created_at: 2026-11-12T18:20:01Z
closed_at: 2026-11-13T10:42:23Z
---

Goal: find every Cargo workspace in the repository with one cargo call each, and keep one metadata report per workspace for the rest of the graph computation.

Implements `REQ-MULTI-WORKSPACE`, `REQ-SKIP-CRATES`, `DES-DISCOVERY` and `DES-METADATA-REPORT` (`nx-rust/docs/workspaces.mara.md`). Checked by `VER-GRAPH`.

- [x] Register the plugin for `Cargo.toml` files. `exclude` is Nx's own filter on the plugin entry, so it needs a test and no code
- [x] Request reports with `--no-deps` (`ADR-METADATA-NO-DEPS`), and one more for a path dependency outside the workspace that has no project
- [x] The claim loop of `DES-DISCOVERY`: shallowest unclaimed manifest, `cargo metadata`, claim the members
- [x] Standalone crates and excluded members become workspaces of one
- [x] Graph creation fails, naming the manifest, when cargo is missing or `cargo metadata` fails; no workspace is left out
- [x] One report per workspace, shared between `createNodes` and `createDependencies`
- [x] Tests on the fixtures, including the count of cargo invocations

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Summary of Changes

The plugin registers `createNodes` for `**/Cargo.toml` and runs the claim loop of `DES-DISCOVERY` (`nx-rust/src/graph/discovery.ts`): the shallowest unclaimed manifest is read with `cargo metadata --format-version 1 --no-deps --manifest-path <manifest>` in its folder, and the report's workspace claims its root and members. Standalone crates and excluded members get a step of their own. Afterwards each path dependency without a project that no report covers gets one more report, started in the root folder of the workspace that uses it (`DES-METADATA-REPORT`). Every cargo call of graph creation goes through `runCargoForGraph` (`nx-rust/src/cargo/run-cargo.ts`), the one place where nxr-1ydrfd can set `RUSTUP_AUTO_INSTALL=0`.

A missing cargo or a failing report fails graph creation with a message that names the manifest (and, for a path dependency, the crate that uses it), carries cargo's output and says what to do. `createDependencies` reads the discovery that `createNodes` made in the same computation (`nx-rust/src/graph/graph-discovery.ts`); every `createNodes` call requests the reports afresh, and the call that started last wins when a daemon overlaps two computations. No projects or edges are created: they belong to nxr-1bv0wm.

Tests (`nx-rust/test/discovery.spec.ts`, real cargo on fixture copies, cargo calls counted with the wrapper): the exact calls for every fixture through Nx; a root workspace, a subfolder workspace and a standalone crate with one call each; `.gitignore`, `.nxignore` and the plugin entry's `exclude` with their positive controls; the path-dependency reports, also for a crate outside the repository; offline graph creation with an empty Cargo home and a registry dependency, which writes no file (positive control: the resolving report fails); the failure messages for a missing cargo (positive control first), a broken manifest, a crate inside a workspace folder that is no member and a failing path-dependency report; and the sharing between the hooks. The end-to-end test checks the call made by the installed plugin. `pinnedToolchainAvailable()` moved into the harness so that both spec files skip `different-toolchains` alike.

Checks run: `pnpm nx run-many -t build lint test` (57 tests pass), `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e` (6 tests pass; locally only with a private pnpm cache folder, see nxr-rq5vqd), `mara schema validate`, `mara project validate` (valid, evaluation complete), `mara related DES-DISCOVERY` and `mara related DES-METADATA-REPORT` (the five `@mara implements` links), `zban check`.
