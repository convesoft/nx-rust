---
title: Infer targets with Nx names and no task dependencies
status: todo
type: feature
priority: high
parent: nxr-w9qa5f
blocked_by:
  - nxr-1bv0wm
  - nxr-kq5pm5
created_at: 2026-11-12T18:20:01Z
---

Goal: every crate gets its targets from its shape, under the default names, with renaming through plugin options.

Implements `REQ-INFERRED-TARGETS`, `REQ-TARGET-NAMES`, `REQ-NO-RUST-TASK-DEPS` and `DES-TARGETS` (`nx-rust/docs/targets.mara.md`, `configuration.mara.md`). Checked by `VER-TARGETS` and `VER-CONFIGURATION`.

- [ ] `build`, `check`, `lint`, `test`, `fmt-check`, `doc` on every crate; `run` and `bench` by target kind; no release targets with `publish = false`
- [ ] Renaming of each target through plugin options
- [ ] No `dependsOn` between Rust crates, and none added to JS projects
- [ ] Tests for each crate shape in the fixtures

Done when: the parts of the cited verification that cover this work pass, and `pnpm exec nx run-many -t build lint test` and `pnpm format:check` pass.
