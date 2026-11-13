---
title: Decide whether the plugin lets rustup install a missing toolchain
status: todo
type: task
tags:
  - spec
parent: nxr-w9qa5f
discovered_from: nxr-qak38j
created_at: 2026-11-13T08:49:52Z
---

Goal: a recorded decision on what graph creation and the toolchain cache input do when a workspace's `rust-toolchain.toml` names a toolchain that rustup has not installed.

Found while building the fixtures (nxr-qak38j). With rustup 1.29.3 on Linux, on 13 November 2026, a plain `rustup show active-toolchain` in a folder whose `rust-toolchain.toml` names `1.91.0` downloaded and installed that toolchain without asking. rustup installs a missing toolchain on first use unless `RUSTUP_AUTO_INSTALL=0` is set; with it set, `rustc -Vv` in that folder fails with "toolchain '1.91.0-x86_64-unknown-linux-gnu' is not installed".

The plugin runs `cargo metadata` in each workspace root when it creates the graph (`DES-DISCOVERY`, `DES-METADATA-REPORT`) and `rustc -Vv` there as a runtime input (`DES-INPUTS`). So, as specified, `nx graph` or any task hash can download a toolchain. That conflicts with "Building the graph needs no network" in `workspaces.mara.md` and touches `ADR-V1-SCOPE` (the plugin does not install toolchains) and `REQ-CARGO-UNCHANGED` (plain cargo would install it as well). The test harness sets `RUSTUP_AUTO_INSTALL=0` for every command it runs (`nx-rust/test/harness/environment.ts`).

Options:

- Leave rustup's default: graph creation and hashing may download a toolchain, as plain cargo would.
- Set `RUSTUP_AUTO_INSTALL=0` for the plugin's graph-time commands (`cargo metadata`, the `rustc -Vv` input) only, so that a missing toolchain fails graph creation or hashing with a message that names it, while tasks keep plain cargo's behaviour.
- Set it for tasks as well.

- [ ] Agree the option with the maintainer
- [ ] Record the decision in Mara and update `DES-DISCOVERY`, `DES-INPUTS`, `DES-DIAGNOSTICS` and the user guidance it changes
- [ ] File the implementation work, or add it to nxr-7n0nqf and nxr-fy4t4k
