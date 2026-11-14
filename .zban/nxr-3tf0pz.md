---
title: A cache hit restores build and doc into an artifact directory that Cargo's configuration outside the repository no longer names
status: todo
type: bug
priority: high
parent: nxr-w9qa5f
discovered_from: nxr-1x4a2k
created_at: 2026-11-14T07:27:27Z
---

Goal: with the Nx daemon on, a change to the artifact directory in a Cargo configuration file that Nx does not watch never lets a cache hit restore `build` or `doc` into the old directory.

`DES-OUTPUTS` names the artifact directory that the `cargo metadata` report gives at graph creation (`build.target-dir`, `CARGO_TARGET_DIR`; `build.build-dir` concerns the same report). The Nx daemon keeps its graph until a file that it watches changes, and a configuration file in the Cargo home or above the repository is none of them. `CARGO_TARGET_DIR` is no input of the key by design (`DES-INPUTS`), and no input covers such a file. `outputs` reach the key through the project's configuration (`EVD-CARGO-TRIPLE-FOLDERS`), but the daemon's outputs are the old ones. nxr-1x4a2k fixed the same defect for the target triple with a runtime input and the executor's check.

Reproduction, 14 November 2026, on the branch of pull request #59 (Nx 24.0.6, cargo 1.100.0), fixture `crate-shapes`, `NX_DAEMON=true`, `CARGO_HOME` a folder beside the repository copy:

1. `$CARGO_HOME/config.toml`: `[build]` with `target-dir = "<repo>/rust/target/a"`; `nx run cli:build` writes `rust/target/a/debug/cli`, and `nx show target cli:build` names `{workspaceRoot}/rust/target/a/…/cli`.
2. Change it to `"<repo>/rust/target/b"` and delete `rust/target/a`; `nx run cli:build` reports a cache hit and puts back `rust/target/a/debug/cli`, the outputs still name `target/a`, and nothing is in `target/b`.
3. A plain `cargo build -p cli` in `rust/` writes `rust/target/b/debug/cli`.

The folders lay inside the ignored `rust/target`. With an unignored `rust/target-a`, deleting it woke the daemon's file watcher, which created the graph afresh, and the task ran into `target-b`.

- [ ] Decide with the user how the key and the executor follow the artifact directory that cargo will use, for example as nxr-1x4a2k does for the triple
- [ ] Update `DES-OUTPUTS`, `DES-INPUTS` and `VER-CARGO-UNCHANGED`
- [ ] Implement it, with a test that runs the real Nx with its daemon

Done when: the reproduction above fails the task or runs cargo instead of restoring into `target/a`, and `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all` and `pnpm nx e2e nx-rust-e2e` pass.
