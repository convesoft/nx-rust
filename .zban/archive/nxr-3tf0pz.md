---
title: A cache hit restores build and doc into an artifact directory that Cargo's configuration outside the repository no longer names
status: done
type: bug
priority: high
parent: nxr-w9qa5f
discovered_from: nxr-1x4a2k
created_at: 2026-11-14T07:27:27Z
closed_at: 2026-11-14T09:03:02Z
---

Goal: with the Nx daemon on, a change to the artifact directory in a Cargo configuration file that Nx does not watch never lets a cache hit restore `build` or `doc` into the old directory.

`DES-OUTPUTS` names the artifact directory that the `cargo metadata` report gives at graph creation (`build.target-dir`, `CARGO_TARGET_DIR`; `build.build-dir` concerns the same report). The Nx daemon keeps its graph until a file that it watches changes, and a configuration file in the Cargo home or above the repository is none of them. `CARGO_TARGET_DIR` is no input of the key by design (`DES-INPUTS`), and no input covers such a file. `outputs` reach the key through the project's configuration (`EVD-CARGO-TRIPLE-FOLDERS`), but the daemon's outputs are the old ones. nxr-1x4a2k fixed the same defect for the target triple with a runtime input and the executor's check.

Reproduction, 14 November 2026, on the branch of pull request #59 (Nx 24.0.6, cargo 1.100.0), fixture `crate-shapes`, `NX_DAEMON=true`, `CARGO_HOME` a folder beside the repository copy:

1. `$CARGO_HOME/config.toml`: `[build]` with `target-dir = "<repo>/rust/target/a"`; `nx run cli:build` writes `rust/target/a/debug/cli`, and `nx show target cli:build` names `{workspaceRoot}/rust/target/a/…/cli`.
2. Change it to `"<repo>/rust/target/b"` and delete `rust/target/a`; `nx run cli:build` reports a cache hit and puts back `rust/target/a/debug/cli`, the outputs still name `target/a`, and nothing is in `target/b`.
3. A plain `cargo build -p cli` in `rust/` writes `rust/target/b/debug/cli`.

The folders lay inside the ignored `rust/target`. With an unignored `rust/target-a`, deleting it woke the daemon's file watcher, which created the graph afresh, and the task ran into `target-b`.

- [x] Decide with the user how the key and the executor follow the artifact directory that cargo will use, for example as nxr-1x4a2k does for the triple (decided by the control plane, see the summary)
- [x] Update `DES-OUTPUTS`, `DES-INPUTS` and `VER-CARGO-UNCHANGED`
- [x] Implement it, with a test that runs the real Nx with its daemon

Done when: the reproduction above fails the task or runs cargo instead of restoring into `target/a`, and `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all` and `pnpm nx e2e nx-rust-e2e` pass.

## Summary of Changes

Decision: the control plane's, under `GOAL-TRUSTED-CACHE`. It applies to the artifact directory the rule that the maintainer was told for the triple on 14 November 2026 and did not object to. It is recorded as `ADR-ARTIFACT-DIR-OUTPUTS`.

- **The key.** The runtime input of a cached `build` and `doc` (formerly `print-triples.js`, now `print-artifact-folders.js`) still runs once per task. It now prints two lines: the triples, and the artifact directory that `cargo metadata --no-deps` reports with the task's environment and `RUSTUP_AUTO_INSTALL=0`. The directory is printed as the outputs name it: the physical folder, relative to the repository's real path, or `artifacts outside the repository`, never a path of the checkout. Graph creation and the script name the folder with one shared function (`repositoryFolder`).
- **Asking cargo.** The plugin asks cargo instead of reading the configuration itself, because cargo 1.91 and later versions read `include` differently. The build directory is not printed: neither the outputs nor the check's verdict about repository files depends on it. `DES-INPUTS` explains why `CARGO_TARGET_DIR` stays out of every other key.
- **The executor.** At the start of a cached `build` or `doc`, the executor asks cargo for the task's directories and compares the artifact directory with the one recorded at graph creation (`artifactDirectory` in the target metadata). When they differ, the task fails before cargo builds. Graph creation also records `CARGO_TARGET_DIR`, `CARGO_BUILD_TARGET_DIR` and `CARGO_HOME`. Where those match the task's environment, or their recorded values also give another directory, the message is the `nx reset` one. Otherwise the message names both folders and the variables (nxr-phcg8v).
- **Cost.** A fully cached `run-many -t build doc` over `two-workspaces` (six tasks, the rustup proxy on `PATH`): medians of 606, 514, 434, 416 and 413 ms on main, against 565, 552, 553, 442 and 429 ms on this branch, in five alternating rounds on a shared machine whose load fell over the rounds. The two quietest pairs differ by 13 and 26 ms. `cargo metadata --no-deps` costs about 6 ms. The numbers are recorded in `EVD-NX-24-MOVED-ARTIFACT-DIRS`.
- **Agreement with cargo.** The input and graph creation agree on every artifact-directory case of #46 and #54: a shared directory reached through `..` or a symbolic link, also before it exists; a link that leads inside; a `build-dir` template; `CARGO_TARGET_DIR`; a configuration at the repository root. `caching.spec.ts` checks this with `expectArtifactInputAgrees`. `target-triples.spec.ts` checks the script's output, including a directory outside the repository and a failing cargo.
- **The reproduction as tests.** `artifact-folders.spec.ts` runs the real Nx with its daemon and `pluginWorkers`. The cases are `build.target-dir` in the Cargo home's configuration, in one above the repository, and the setting removed, with the folders inside the ignored `rust/target`. Each run of `cli:build` and `rust:doc` is no hit, puts nothing back into `rust/target/a`, builds nothing and gives the `nx reset` message. After `nx daemon --stop`, both are stored and restored in the new folder. Each test stops its daemon. With the executor's check disabled, 9 of these tests fail.

Checks run: `pnpm nx run-many -t build lint test` (1002 passed, 1 todo), `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e --skip-nx-cache` (30 passed; four expectations now include the extra `cargo metadata` calls), `mara schema validate` and `mara project validate` (valid, evaluation complete, no warnings), and `zban check`.

Rejected: comparing only the variables (misses a stale configuration and `build-dir` templates); reading the configuration chain ourselves (`include` differs between Cargo versions). Filed nxr-z03xcp, a `doc` restored into a directory that another workspace has come to share under the daemon. By the control plane's decision it was cancelled in this pull request as a limit that `DES-OUTPUTS` now states.
