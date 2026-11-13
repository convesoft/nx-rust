---
title: Run cargo through the plugin's executor, one call per task
status: done
type: feature
priority: high
parent: nxr-w9qa5f
blocked_by:
  - nxr-t1ht7j
created_at: 2026-11-12T18:20:01Z
closed_at: 2026-11-13T15:46:40Z
---

Goal: the inferred targets run. In this milestone each task starts its own cargo command; the batch implementation follows in 0.2.

Implements `REQ-CARGO-UNCHANGED`, `REQ-NO-MANIFEST-WRITES`, `DES-INVOCATION`, the commands of `DES-TARGET-COMMANDS` and `DES-WORKSPACE-TARGETS`, and the `cargo` runner of `REQ-TEST-RUNNER` (`nx-rust/docs/caching.mara.md`, `targets.mara.md`, `setup.mara.md`, `testing.mara.md`). Checked by `VER-CARGO-UNCHANGED` and `VER-TARGETS`.

- [x] An executor that builds the cargo command from the target's options, with the real package name and manifest path
- [x] The commands of `DES-TARGET-COMMANDS` and `DES-WORKSPACE-TARGETS`, with the target options of `DES-PLUGIN-OPTIONS` that switch their flags
- [x] The other target options of `DES-PLUGIN-OPTIONS`, on the targets that item gives them
- [x] `run` through an executor without a batch implementation
- [x] `executors.json` entries for the names the inferred targets carry: `@convesoft/nx-rust:cargo` for every target but `run`, `@convesoft/nx-rust:run` for `run` (`DES-TARGETS`; `cargoExecutor` and `runExecutor` in `nx-rust/src/graph/targets.ts`)
- [x] Take the command of a task from `metadata.cargo.target` of its target, the target's default name, so that a target renamed through `targetNames` runs the same command (`DES-TARGETS`; `TargetCargoMetadata` in `nx-rust/src/graph/targets.ts`)
- [x] Keep the defaults `allTargets: true` of `check` and `lint` and `noDeps: true` of `doc` in the targets' options, where nxr-t1ht7j puts them, and not in the schema: one schema serves every target of the cargo executor, and a schema default would reach `build` too
- [x] `nx run-many -t lint` in a mixed fixture runs a JS lint target and clippy (`VER-CONFIGURATION`); `nx-rust/test/targets.spec.ts` checks the task graph of that command
- [x] If this issue lands before nxr-fy4t4k: make sure that a `targetDefaults` entry in `nx.json` that sets `cache: true` on an inferred target, keyed by the target's name or by its executor, cannot cache a result under Nx's default inputs while the plugin infers `cache: false` for the target (`GOAL-TRUSTED-CACHE`; the interim rule is in the status note of `nx-rust/docs/targets.mara.md`, the cached targets in `DES-TARGETS`). Today nothing is restored, because Nx stops at the missing executor before it hashes. If nxr-fy4t4k landed first and dealt with it, tick this
- [x] Commands start in the workspace root, with no directory or flag that plain cargo would not use
- [x] The `locked` option and `NX_RUST_LOCKED`, as `DES-INVOCATION` and `DES-WORKSPACE-TARGETS` describe them
- [x] Terminal output and exit status passed through to Nx
- [x] End-to-end: Nx and plain cargo reuse each other's builds; `git status` is clean afterwards

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Summary of Changes

- The executors `@convesoft/nx-rust:cargo` and `@convesoft/nx-rust:run` (`nx-rust/src/executors/`, `nx-rust/executors.json`, `executors` in `nx-rust/package.json`). Each task runs one cargo command in its workspace's root folder, with the task's environment unchanged and cargo's standard streams as its own, and succeeds when cargo exits with 0. Neither executor has a batch implementation. The command comes from `metadata.cargo.target` (`cargoArguments` in `command.ts`). Crates are selected with `-p` and the package name from the project's `metadata.cargo`. The workspace folder comes from `workspaceManifest` there. The commands are those of `DES-TARGET-COMMANDS` and `DES-WORKSPACE-TARGETS`. The target options of `DES-PLUGIN-OPTIONS` set flags only on the targets that the item gives them: `features`, `allFeatures`, `noDefaultFeatures` and `profile` on build, check, lint, test, bench, run and doc, `targetTriple` on the same targets except test, `allTargets` on check and lint, `noDeps` on doc, and `bin` on run. `affectedTests` and `pluginVersion` are declared and set no flag. The schemas are `version: 2` with `outputCapture: "pipe"`, as Nx's own executors are, declare no `verbose` and leave `additionalProperties` unset. Nx 24.0.6 then passes an undeclared option through, and the executor leaves it out of the command.
- Locked mode: `readLocked` reads `locked` from the plugin options at graph creation and fails it for a value that is not a boolean. Each target carries the value as `metadata.cargo.locked`, which is not in the task hash. `NX_RUST_LOCKED` set to `true` or `false` replaces it. An empty value counts as unset, and any other value fails the task. `--locked` goes on every command but `update`, `fmt`, `fmt-check` and `audit`, and on `deny` as `cargo deny --locked check`. `DES-DIAGNOSTICS` has two new rows for the two errors, and `DES-TARGETS` names `metadata.cargo.locked`.
- `targetDefaults` and `cache: true`: nxr-fy4t4k has not landed, so the executor fails a task, before cargo runs, when its merged configuration has `cache: true` and its default name is not in `cachedTargets` (`nx-rust/src/graph/targets.ts`, empty for now; the plugin's `cache:` comes from the same set). The message says how to find the source with `nx show target … --json` and how to narrow a `targetDefaults` entry. Nx stores no successful result for a failed task, so nothing is restored. nxr-fy4t4k has a step to fill the set, which lifts the check for the targets it caches. nxr-d3087e, in progress, makes such an entry an error at graph creation; this check is a second line of defence that it may keep or remove.
- CI installs clippy and rustfmt (`--component clippy,rustfmt`) for the lint, fmt and fmt-check tasks in the tests. The Rust sources of every fixture are formatted now, and `fixtures.spec.ts` checks that with `rustfmt --check`.
- Docs: the status notes of the Targets, Workspaces, Configuration, Caching, Testing and CI pages say what runs now and what is still missing. The Caching guide says that `audit` passes no `--locked`.
- Left to their issues, each of which has a step: `args` on run, arguments after `--` and the warning for unknown options go to nxr-wea5vt; `allTargets = false` and a continuous run from metadata tables, and the graph-time check of options in the tables against the schemas, go to nxr-xyq7c8; the missing-tool error of `audit` and `deny` (`VER-TARGETS`) goes to nxr-zqvnrh, which comes with the compatibility pull request (#27) and calls its `requireTool` from the executors (`runTask` in `nx-rust/src/executors/task.ts`); caching goes to nxr-fy4t4k; the lockfile task goes to nxr-xq9ava; the task-time `--affectedTests=true` error goes to nxr-tabkjx; batching is milestone 0.2. Filed nxr-mbddj1 for two open questions: a declared option on a target that does not take it, and a target that names the executor without being inferred. nxr-maxy88's check is in this change and that issue is closed.

Checks run:
- `nx-rust/test/executors.spec.ts`, 29 tests with a real cargo and real Nx task runs through the cargo wrapper. They cover the command of every crate target and every workspace target, with the package name for a project named otherwise, under renamed targets, and with each option on the targets that take it and on those that do not. They also cover: no flag that denies warnings; two calls for `run-many -t run`; the workspace root where a member's toolchain file would fail; no `RUSTUP_AUTO_INSTALL` on the task's cargo while graph creation has `0`; cargo's output and exit status passed on; every task running again on a second run; the cache check by target name, by either executor and with the empty entry keyed by the executor, against a positive control in which Nx restores a JS target under the same entry; locked mode by option and by variable, both ways; `Cargo.lock` updated as plain cargo does and left alone in locked mode while `update` changes it; `fmt` touching only crates that have projects; and a mixed `run-many -t lint` that runs the JS lint and clippy.
- `pnpm nx run-many -t build lint test`: 11 suites, 244 tests, passed.
- `pnpm nx format:check --all`: passed.
- `pnpm nx e2e nx-rust-e2e`: 14 tests passed, among them the three new ones. The installed plugin runs `api:build`. Plain cargo after Nx, and Nx after plain cargo from a clean target folder, compile nothing. `git status` is clean after `run-many -t build check lint test fmt-check fmt doc update`.
- `mara schema validate` and `mara project validate`: valid, evaluation complete, 0 errors and 0 warnings. `mara related` shows the links for `DES-INVOCATION`, `DES-TARGET-COMMANDS`, `DES-WORKSPACE-TARGETS`, `DES-TARGETS`, `DES-PLUGIN-OPTIONS`, `REQ-TEST-RUNNER`, `REQ-CARGO-UNCHANGED` and `REQ-NO-MANIFEST-WRITES`.
- `zban check`: passed.
- CI on the pull request covers the jobs with the components that CI now installs.
