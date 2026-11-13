---
title: Run cargo through the plugin's executor, one call per task
status: todo
type: feature
priority: high
parent: nxr-w9qa5f
blocked_by:
  - nxr-t1ht7j
created_at: 2026-11-12T18:20:01Z
---

Goal: the inferred targets run. In this milestone each task starts its own cargo command; the batch implementation follows in 0.2.

Implements `REQ-CARGO-UNCHANGED`, `REQ-NO-MANIFEST-WRITES`, `DES-INVOCATION`, the commands of `DES-TARGET-COMMANDS` and `DES-WORKSPACE-TARGETS`, and the `cargo` runner of `REQ-TEST-RUNNER` (`nx-rust/docs/caching.mara.md`, `targets.mara.md`, `setup.mara.md`, `testing.mara.md`). Checked by `VER-CARGO-UNCHANGED` and `VER-TARGETS`.

- [ ] An executor that builds the cargo command from the target's options, with the real package name and manifest path
- [ ] The commands of `DES-TARGET-COMMANDS` and `DES-WORKSPACE-TARGETS`, with the target options of `DES-PLUGIN-OPTIONS` that switch their flags
- [ ] The other target options of `DES-PLUGIN-OPTIONS`, on the targets that item gives them
- [ ] `run` through an executor without a batch implementation
- [ ] Commands start in the workspace root, with no directory or flag that plain cargo would not use
- [ ] The `locked` option and `NX_RUST_LOCKED`, as `DES-INVOCATION` and `DES-WORKSPACE-TARGETS` describe them
- [ ] Terminal output and exit status passed through to Nx
- [ ] End-to-end: Nx and plain cargo reuse each other's builds; `git status` is clean afterwards

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
