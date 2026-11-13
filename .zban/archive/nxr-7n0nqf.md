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

The plugin finds the Cargo workspaces among the manifests that Nx hands to each of its entries in `nx.json`, with the claim loop of `DES-DISCOVERY` (`nx-rust/src/graph/discovery.ts`). The shallowest unclaimed manifest is read with `cargo metadata --format-version 1 --no-deps --manifest-path <manifest>` in its folder, and the report's workspace claims its root and members. Standalone crates and excluded members get a step of their own. Then each path dependency without a project that no report covers gets one more report, started in the root folder of the workspace that uses it (`DES-METADATA-REPORT`). Every cargo call of graph creation goes through `runCargoForGraph` (`nx-rust/src/cargo/run-cargo.ts`), the one place where nxr-1ydrfd can set `RUSTUP_AUTO_INSTALL=0`. A missing cargo or a failing report fails graph creation with a message that names the manifest (for a path dependency, also the crate that uses it), carries cargo's output and says what to do. No projects or edges are created: they belong to nxr-1bv0wm.

Each entry keeps its own discovery (`nx-rust/src/graph/registration.ts`). The plugin's `createNodes` is a getter, so each copy that Nx makes of the module for an entry gets a registration of its own, and `createDependencies`, which Nx calls as a method of that copy, finds it there. Every `createNodes` call requests the reports afresh; the call that started last wins when a daemon overlaps two computations. Entries that Nx runs in one process share the reports of one computation (`nx-rust/src/graph/computation-reports.ts`): a report is reused for a manifest it covers, so a workspace split between two entries is read once there. Isolated plugin workers cannot share it, so there it is read once per entry. The review of PR #10 found the first version sharing one module-level result between entries; `EVD-NX-PLUGIN-ENTRIES` records the Nx 24 behaviour behind the fix.

Knowledge: `DES-DISCOVERY` now says what `exclude` does (no project, not read as a workspace, still one report when a crate depends on it by path), as the maintainer answered on 13 November 2026. `DES-METADATA-REPORT` says that the report is shared within one plugin entry and read once for each entry that receives a workspace's manifests, unless the entries share a process. The new `EVD-NX-PLUGIN-ENTRIES` supports it. The status note and the `exclude` guidance in `workspaces.mara.md` and the examples in `nx-rust/test/README.md` describe what works today.

Tests (`nx-rust/test/discovery.spec.ts`, real cargo on fixture copies, cargo calls counted with the wrapper): the exact calls for every fixture through Nx; a root workspace, a subfolder workspace and a standalone crate with one call each; `.gitignore`, `.nxignore` and `exclude` against positive controls; path-dependency reports, also outside the repository; offline graph creation with an empty Cargo home, writing no file; the failure messages; the sharing between the hooks; and two entries through real Nx with isolation on and off, observed with the probe plugin `nx-rust/test/harness/discovery-probe.ts`. Without the fix, the one-process tests fail: with one registration shared by all entries, both entries see the second entry's discovery; without shared reports, the split workspace is read twice. The end-to-end test checks the call that the installed plugin makes.

Checks run on the final commit: `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e` (with a private pnpm cache folder, see nxr-rq5vqd), `mara schema validate`, `mara project validate` (valid, evaluation complete), `mara related DES-DISCOVERY` and `mara related DES-METADATA-REPORT` (the `@mara implements` links), `zban check`.
