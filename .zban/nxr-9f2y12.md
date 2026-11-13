---
title: Key the compiler that RUSTC or CARGO_BUILD_RUSTC names
status: todo
type: task
tags:
  - spec
parent: nxr-w9qa5f
discovered_from: nxr-0haa7z
created_at: 2026-11-13T15:20:15Z
---

Goal: the toolchain in a task's key is the compiler that cargo uses for the task, also when `RUSTC` or `CARGO_BUILD_RUSTC` names one, or the knowledge base states where it is not.

Concerns `REQ-TOOLCHAIN-KEY`, the toolchain and environment inputs of `DES-INPUTS` (`nx-rust/docs/caching.mara.md`), `ADR-WORKSPACE-ROOT` (`nx-rust/docs/decisions.mara.md`) and `RISK-UNDECLARED-INPUTS`.

Observed while researching nxr-0haa7z on 2026-11-13, with rustup 1.29.3 and the toolchains 1.98.1 (pinned by the workspace's `rust-toolchain.toml`) and 1.97.1, not yet recorded as evidence: with `RUSTC` or `CARGO_BUILD_RUSTC` set to the 1.97.1 `rustc`, `cargo build -v` in the workspace root compiled with 1.97.1 and passed that path to build scripts as `RUSTC`, while `rustc -Vv` in the same folder and environment reported 1.98.1. The `env` inputs hash only the variable's text, so an update of the compiler at that path, such as `rustup update stable` for a channel's path, changes no key. `build.rustc` in a `.cargo/config.toml` should behave the same way; that was not tried.

- [ ] Reproduce the observation and record it as an evidence item, also for `build.rustc`
- [ ] Propose to the maintainer how the toolchain input follows these settings, or which of them stay a stated limit, and update the items
- [ ] Extend `VER-CACHE-KEYS` with the cases the answer covers

Done when: the maintainer has decided, the items say what the key holds in each case, and `mara schema validate` and `mara project validate` report `valid: true`.
