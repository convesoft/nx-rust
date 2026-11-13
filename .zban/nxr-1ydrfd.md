---
title: Decide whether the plugin lets rustup install a missing toolchain
status: in-progress
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

- [x] Agree the option with the maintainer
- [x] Record the decision for graph creation in Mara (`ADR-GRAPH-NO-TOOLCHAIN-INSTALL`, `EVD-RUSTUP-MISSING-TOOLCHAIN`), with the folders of the graph-time calls, and update `DES-DISCOVERY`, `DES-METADATA-REPORT`, `VER-SETUP` and the workspaces guide
- [x] File the graph-time implementation (nxr-66wa7d)
- [ ] Agree with the maintainer what the toolchain input of a task's key does when the pinned toolchain is missing. Nx 24 keys a task on the output of a failing runtime input and runs it (`EVD-RUSTUP-MISSING-TOOLCHAIN`), so the accepted error "when a task's key is computed" in `DES-DIAGNOSTICS` and `VER-SETUP` cannot come from Nx
- [ ] Record that answer: `ADR-GRAPH-NO-TOOLCHAIN-INSTALL` or a decision of its own, `DES-INPUTS`, `DES-DIAGNOSTICS`, `VER-SETUP`, a case in `VER-CACHE-KEYS`, and the caching and setup guidance it changes
- [ ] Add the agreed toolchain-input work to the step that nxr-fy4t4k holds for it
