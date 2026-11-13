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

Goal: every crate and every workspace project gets its targets from its shape, under the default names, with renaming through plugin options.

Implements `REQ-INFERRED-TARGETS`, `REQ-TARGET-NAMES`, `REQ-NO-RUST-TASK-DEPS`, `DES-TARGETS`, and the target configuration of `DES-TARGET-COMMANDS` and `DES-WORKSPACE-TARGETS` (`nx-rust/docs/targets.mara.md`, `configuration.mara.md`). Checked by `VER-TARGETS` and `VER-CONFIGURATION`.

- [ ] `build`, `check`, `lint`, `test`, `fmt-check` and `fmt` on every crate; `run` and `bench` by target kind; no release targets with `publish = false`
- [ ] `doc`, `audit` and `update` on every workspace project, and `deny` where `deny.toml`, `.deny.toml` or `.cargo/deny.toml` is in the workspace root; the same targets whether or not cargo-audit and cargo-deny are installed
- [ ] Take those file names from `cargoDenyConfigurationFiles` (`nx-rust/src/tools/optional-tools.ts`), from which `init` tells whether cargo-deny is needed, so that both agree
- [ ] `bench` with `parallelism: false`; `run` on an executor without a batch implementation and not continuous; `fmt`, `bench`, `run`, `audit`, `deny` and `update` uncached, the last three with the inputs `DES-WORKSPACE-TARGETS` lists
- [ ] Renaming of each target through plugin options, with the graph-creation error for two inferred targets that get one name (`DES-PLUGIN-OPTIONS`, `DES-DIAGNOSTICS`)
- [ ] No `dependsOn` between Rust crates, and none added to JS projects
- [ ] Tests for each crate shape in the fixtures

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
