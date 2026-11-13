---
title: Declare cache inputs and outputs
status: todo
type: feature
priority: high
parent: nxr-w9qa5f
blocked_by:
  - nxr-t1ht7j
  - nxr-5p9zq5
created_at: 2026-11-12T18:20:01Z
---

Goal: every cached target declares complete inputs and only final outputs.

Implements `REQ-INPUT-FILES`, `REQ-ENV-ALLOWLIST`, `REQ-TOOLCHAIN-KEY`, `REQ-CACHE-OUTPUTS`, `DES-INPUTS`, `DES-OUTPUTS` and `DES-BUILD-DIRS` (`nx-rust/docs/caching.mara.md`). Checked by `VER-CACHE-KEYS` and `VER-CARGO-UNCHANGED`. The whole `Cargo.lock` is the interim input for external dependencies.

- [ ] The whole crate folder as the crate-file input, and real paths for workspace files, including every `.cargo/config.toml` and `rust-toolchain.toml` that applies
- [ ] Inputs for path dependencies without a project, with the warning where Nx cannot see them, and for tool configuration files
- [ ] `^` inputs over normal, build and dev-dependency edges
- [ ] The environment allowlist and the repository's additions
- [ ] The toolchain runtime input, run in the workspace root
- [ ] Outputs: executables, `cdylib` and `staticlib` files for `build`, the whole doc folder of the artifact directory for the workspace project's `doc`, none elsewhere; nothing inside the build directory; no caching of `build` and `doc` when the artifact directory is outside the repository, and none of `doc` when two workspaces share one artifact directory
- [ ] The cache-key matrix rows for all of the above

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
