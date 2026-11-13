---
title: Read a workspace's artifact directory in the folder where its tasks run cargo
status: in-progress
type: bug
parent: nxr-w9qa5f
discovered_from: nxr-zz36hb
created_at: 2026-11-13T19:30:19Z
---

Goal: the graph names the artifact directory, and the other things that Cargo's configuration decides, that the workspace's tasks actually use, so that `build` outputs and a cache hit match what cargo wrote (`GOAL-TRUSTED-CACHE`, `DES-OUTPUTS`).

Context: `readWorkspace` in `nx-rust/src/graph/discovery.ts` runs `cargo metadata` in the folder of the first manifest of the workspace that Nx hands the plugin (`shallowestFirst`). That folder is the workspace root only when the root manifest is handed. Tasks run every cargo command in the workspace root (`DES-INVOCATION`, `ADR-WORKSPACE-ROOT`, `nx-rust/src/executors/task.ts`). Cargo finds `.cargo/config.toml` files from the folder it starts in, and resolves a relative `CARGO_TARGET_DIR` against that folder, so the two can disagree.

Observed on 13 November 2026 with cargo 1.100.0 and Nx 24, while working on nxr-zz36hb: in the `crate-shapes` fixture, with the plugin entry's `exclude` set to `["rust/Cargo.toml"]` and `rust/crates/cli/.cargo/config.toml` holding `[build]` `target-dir = "member-target"`, graph creation made its only `cargo metadata` call in `rust/crates/cli`. The `build` outputs of `cli` and `server` then named `{workspaceRoot}/rust/crates/cli/member-target/...`, while the tasks would run in `rust/` and write to `rust/target`. A cached `build` would then store no artifact, and a cache hit would restore none. A relative `CARGO_TARGET_DIR` should behave the same way, by Cargo's rule above; this was not run.

How to fix it is the maintainer's decision. For example, a second `cargo metadata` call in `workspace_root` where the first one started elsewhere would cost an extra call (`REQ-MULTI-WORKSPACE`). The same folder also decides `buildTargetFiles`, the redirections that are read and the toolchain of graph creation.

- [ ] Decide in Mara (`DES-DISCOVERY`) which folder graph creation reads a workspace's report in, and where a different folder is acceptable
- [ ] Make graph creation and tasks agree on the artifact directory where the root manifest is not handed, with a test that uses the excluded root manifest above
