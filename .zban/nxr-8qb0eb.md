---
title: Check the Cargo version that a task's own environment selects
status: todo
type: bug
priority: low
discovered_from: nxr-sefq12
created_at: 2026-11-14T16:39:08Z
---

Goal: a task whose environment selects a Cargo older than 1.91 stops with the error that `REQ-COMPATIBILITY` asks for, as graph creation does.

Context: graph creation checks the Cargo version of each workspace (`DES-DIAGNOSTICS`, "Cargo older than 1.91 in a workspace"). A task can still run another toolchain through its own environment, such as `RUSTUP_TOOLCHAIN` in a crate's `.env` (`DES-INVOCATION`, `DES-INPUTS` "Toolchain"), and no check runs then. Since nxr-sefq12 each task selects its crate with the `id` that `cargo metadata --no-deps` reports (`DES-INVOCATION`, `EVD-CARGO-PACKAGE-SPECS`). Cargo's changelog says that ids took the package ID specification form in 1.77; an older cargo would report another form, and the task would fail with cargo's message about an invalid specification instead of one that names the versions. Not run: no toolchain older than 1.89 is installed here.

- [ ] Decide where a task checks the version of its cargo (for example from the same `cargo metadata` call, or `cargo --version` with the task's environment) and record it in `DES-DIAGNOSTICS` and `REQ-COMPATIBILITY`'s verification
- [ ] Implement the check with a message that names the version found, the version required and the setting that selects the toolchain

Done when: the checks pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
