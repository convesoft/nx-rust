---
title: Add the test mode input
status: todo
type: feature
priority: high
parent: nxr-m3k3w8
blocked_by:
  - nxr-jb6g5y
created_at: 2026-11-12T18:20:01Z
---

Goal: the mode (`full` or `affected:<baseline commit>`) is part of every `test` cache key.

Implements `REQ-TEST-MODE-KEY` and `DES-TEST-MODE` (`nx-rust/docs/testing.mara.md`). Checked by `VER-TESTING` and `VER-CACHE-KEYS`. Depends on what the Nx 24 input spike found about runtime inputs.

- [ ] The plugin command that prints the mode
- [ ] The runtime input on the `test` target
- [ ] The mode rule of `DES-TEST-MODE`: `NX_RUST_TEST_MODE`, the default per environment, the fallback without a baseline, and `--affectedTests=false`
- [ ] Matrix rows for mode and baseline changes

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
