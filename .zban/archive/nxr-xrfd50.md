---
title: Read a workspace's artifact directory in the folder where its tasks run cargo
status: done
type: bug
parent: nxr-w9qa5f
discovered_from: nxr-zz36hb
created_at: 2026-11-13T19:30:19Z
closed_at: 2026-11-13T21:14:34Z
---

Goal: the graph names the artifact directory, and the other things that Cargo's configuration decides, that the workspace's tasks actually use, so that `build` outputs and a cache hit match what cargo wrote (`GOAL-TRUSTED-CACHE`, `DES-OUTPUTS`).

Context: `readWorkspace` in `nx-rust/src/graph/discovery.ts` runs `cargo metadata` in the folder of the first manifest of the workspace that Nx hands the plugin (`shallowestFirst`). That folder is the workspace root only when the root manifest is handed. Tasks run every cargo command in the workspace root (`DES-INVOCATION`, `ADR-WORKSPACE-ROOT`, `nx-rust/src/executors/task.ts`). Cargo finds `.cargo/config.toml` files from the folder it starts in, and resolves a relative `CARGO_TARGET_DIR` against that folder, so the two can disagree.

Observed on 13 November 2026 with cargo 1.100.0 and Nx 24, while working on nxr-zz36hb: in the `crate-shapes` fixture, with the plugin entry's `exclude` set to `["rust/Cargo.toml"]` and `rust/crates/cli/.cargo/config.toml` holding `[build]` `target-dir = "member-target"`, graph creation made its only `cargo metadata` call in `rust/crates/cli`. The `build` outputs of `cli` and `server` then named `{workspaceRoot}/rust/crates/cli/member-target/...`, while the tasks would run in `rust/` and write to `rust/target`. A cached `build` would then store no artifact, and a cache hit would restore none. A relative `CARGO_TARGET_DIR` should behave the same way, by Cargo's rule above; this was not run.

How to fix it is the maintainer's decision. For example, a second `cargo metadata` call in `workspace_root` where the first one started elsewhere would cost an extra call (`REQ-MULTI-WORKSPACE`). The same folder also decides `buildTargetFiles`, the redirections that are read and the toolchain of graph creation.

- [x] Decide in Mara (`DES-DISCOVERY`) which folder graph creation reads a workspace's report in, and where a different folder is acceptable
- [x] Make graph creation and tasks agree on the artifact directory where the root manifest is not handed, with a test that uses the excluded root manifest above

## Summary of Changes

The control plane decided the open question, on the basis of `GOAL-TRUSTED-CACHE`, `ADR-WORKSPACE-ROOT` and `DES-OUTPUTS` (outputs must name where the files are): graph creation takes everything that Cargo's configuration decides for a workspace (artifact and build directories, the configuration file that sets `build.target`, the redirections that are read, the toolchain) from the workspace root, where its tasks run cargo. Where the first `cargo metadata` call ran elsewhere because Nx did not hand the root manifest, graph creation makes one more call in the reported `workspace_root` and takes the workspace from that report; only such workspaces pay the extra call. Recorded in `DES-DISCOVERY` (new "Root folder" paragraph), `DES-METADATA-REPORT` (call count and the paragraph on where reports start) and the cargo-call count of `REQ-MULTI-WORKSPACE`; `VER-GRAPH`, `VER-CARGO-UNCHANGED` and `VER-SETUP` name the new checks.

Reproduced first with the real Nx on `main` (ab21f45). Since lockfile hashing, the issue's single-entry case leaves `build` uncached, so the reproduction gives the root manifest to a second plugin entry, which gives the workspace its lockfile task and keeps `cli:build` cached. With `rust/crates/cli/.cargo/config.toml` setting `target-dir = "member-target"`, the `build` outputs of `cli` named `rust/crates/cli/member-target/...` in plugin workers and in one process (where the root-manifest entry reused the member-folder report, so `doc` named it too). `nx run cli:build` wrote `rust/target/debug/cli`, and after deleting it a second run was a cache hit that restored nothing. A relative `CARGO_TARGET_DIR=env-target` behaved the same way: outputs in `rust/crates/cli/env-target`, tasks writing to `rust/env-target`, and a hit that restored nothing. With one entry only, the graph named `rust/crates/cli/member-target` (or `.../env-target`) as the workspace's unignored directory.

Code: `ComputationReports` (`computation-reports.ts`) remembers the folder each report started in, and `requestFromRoot` reuses only a report that started in the workspace root. `readWorkspace` (`discovery.ts`) asks for the root-folder report when the first one started elsewhere, and its error names the folder of the call that failed.

Tests: `caching.spec.ts` (outputs and `doc` in the root folder's directory for the member config and the relative `CARGO_TARGET_DIR`, with plugin isolation on and off, and the warning and cargo calls with one entry); `caching-runs.spec.ts` (real `nx run cli:build` twice with the binary deleted in between: the hit puts it back, for both cases); `discovery.spec.ts` (a call in `rust/crates/api` and then one in `rust`; the two-entry count in plugin workers is now three calls); `missing-toolchain.spec.ts` (a toolchain pinned in the root folder and not installed fails graph creation, naming `rust`, although the member folder pins an installed one). Each new test failed on the unchanged code and passes now.

Checks run: `pnpm nx run-many -t build lint test` (28 suites, 829 tests passed), `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e --skip-nx-cache` (30 tests passed), `mara schema validate`, `mara project validate` (valid, evaluation complete) and `zban check`. Merged with `origin/main` at 294b249 before the runs.
