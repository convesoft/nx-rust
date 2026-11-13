---
title: Check that the executor's cargo gets no RUSTUP_AUTO_INSTALL from the plugin
status: done
type: task
parent: nxr-w9qa5f
blocked_by:
  - nxr-kmdpgj
discovered_from: nxr-66wa7d
created_at: 2026-11-13T14:59:59Z
closed_at: 2026-11-13T15:45:39Z
---

Goal: the task half of the missing-toolchain case in `VER-SETUP` is checked with the plugin's own executor. `ADR-GRAPH-NO-TOOLCHAIN-INSTALL` and `REQ-CARGO-UNCHANGED` say that tasks keep rustup's default.

nxr-66wa7d set the variable for graph-time cargo only (`runCargoForGraph`). `nx-rust/test/missing-toolchain.spec.ts` checks today that graph creation leaks nothing into a task, using the harness's probe executor, because the plugin has no executor yet. The executor's issue (nxr-kmdpgj) cites `VER-CARGO-UNCHANGED` and `VER-TARGETS`, not this sentence of `VER-SETUP`.

- [x] Once the executor runs cargo, a test that runs an inferred target with `RUSTUP_AUTO_INSTALL` removed from Nx's environment and checks with the cargo wrapper's `callsWithEnv` that the task's cargo call has it unset, while graph creation's calls have `0`
- [x] That test pins no toolchain that is missing, so that a failure cannot download one

Done when: the check above passes, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Summary of Changes

Checked in nxr-kmdpgj's pull request, which added the executor, as its coordinator asked. `nx-rust/test/executors.spec.ts`, "gives cargo the environment of the task, without RUSTUP_AUTO_INSTALL": `nx run core-lib:check` in the `crate-shapes` fixture, which pins no toolchain, runs with `RUSTUP_AUTO_INSTALL` removed from Nx's environment, and the cargo wrapper's `callsWithEnv` shows `0` for graph creation's `cargo metadata` and no value for the task's `cargo check --all-targets -p core-lib`. The executor passes the task's environment to cargo unchanged (`runCargo` in `nx-rust/src/executors/task.ts`). `nx-rust/test/missing-toolchain.spec.ts` still checks graph creation with the probe executor.

Checks run: `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` passed; see nxr-kmdpgj for the rest.
