---
title: Fail a task whose tool is missing, and repeat the Nx version warning at task start
status: done
type: feature
parent: nxr-w9qa5f
blocked_by:
  - nxr-kmdpgj
discovered_from: nxr-q6cxt3
created_at: 2026-11-13T15:26:16Z
closed_at: 2026-11-13T20:27:37Z
---

Goal: a task that runs a tool which is not installed fails before cargo runs, with the message that `DES-DIAGNOSTICS` (`nx-rust/docs/setup.mara.md`) asks for, and the warning for an unsupported Nx under `NX_RUST_ALLOW_UNSUPPORTED_NX` also appears where the daemon hides graph-time output. Implements the task-time rows of `DES-DIAGNOSTICS` for missing tools and its "Warnings where they are seen" paragraph for that warning, under `REQ-DIAGNOSTICS` and `ADR-V1-SCOPE`. Checked by `VER-SETUP`.

Context: nxr-q6cxt3 built the check without the executor, which did not exist yet. `requireTool(id, neededBy, context)` in `nx-rust/src/tools/optional-tools.ts` throws a `MissingToolError` whose message names the tool, what needs it and how to get it, from the same table that `init` reports; `test/missing-tools.spec.ts` checks it for every tool. `ToolContext.folder` names the folder whose toolchain counts for the wasm target. The Nx verdict comes from `nxVerdictFor(workspaceRoot, env)` in `nx-rust/src/compatibility/nx-version.ts`.

- [x] Call `requireTool` from the executors at the start of each task that runs a tool of the table (`audit`, `deny`, and the targets and settings that later issues add), before cargo runs, so that the task fails and no success is cached. The executors of nxr-kmdpgj start every task in `runTask` (`nx-rust/src/executors/task.ts`), which turns a `TaskError` into the task's message; `audit` and `deny` reach cargo today and fail with its message for an unknown command, which the test "runs the workspace project's targets in the workspace root" in `nx-rust/test/executors.spec.ts` expects
- [x] The `audit` and `deny` case of `VER-TARGETS`: with cargo-audit or cargo-deny removed from `PATH`, the task fails with the missing-tool message
- [x] Wherever cargo-deny is available, never by installing it: `deny` against a stale `Cargo.lock` in locked mode fails and leaves the file unchanged, both with the `locked` option and with `NX_RUST_LOCKED=true` (`VER-CARGO-UNCHANGED`). nxr-kmdpgj checks only the arguments, `cargo deny --locked check`, because the tool is installed neither on the development machine nor in CI
- [x] Name the target or setting and the crate or workspace in `neededBy`, as `DES-DIAGNOSTICS` asks
- [x] Print the warning of an unsupported Nx with `NX_RUST_ALLOW_UNSUPPORTED_NX=true` again from the executor at the start of each task
- [x] Print the graph-time warnings about redirections again from the executor at the start of each task of the workspace they concern (`DES-DIAGNOSTICS`, "Warnings where they are seen", and its rows for `ADR-REDIRECTION-EDGES` and `DES-METADATA-REPORT`): a configuration file outside the repository with `[patch]` or `paths`, an included file that is no valid TOML, and a redirected crate that `cargo metadata` fails for. Graph creation prints them from `CargoDiscovery.warnings` (nxr-p5ybc0), which holds plain messages without the workspace they concern. Since nxr-fy4t4k, the executor prints each warning in a project's `metadata.cargo.warnings` at the start of its tasks (`projectWarnings` in `nx-rust/src/executors/task.ts`; `projectWarnings` in `nx-rust/src/graph/caching.ts` fills it), so giving these warnings to the projects of the workspace they concern is enough
- [x] Tests: for each tool, removing it from `PATH` and running a task that needs it fails with that message, and nothing is installed (`VER-SETUP`, fifth paragraph); hide installed tools with an empty `PATH` and Cargo home (`ToolFolders` in `nx-rust/test/harness`) and install none
- [x] End-to-end: one such task through the installed plugin

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Summary of Changes

Already on `main` before this work: the executor printed each warning in a project's `metadata.cargo.warnings` at the start of its tasks (nxr-fy4t4k), and that list already held the warnings about unignored Cargo directories (#41), path dependencies that cargo does not report (#42) or whose files Nx cannot see, shared or outside artifact directories and a configured `build.target`. Not there yet: the three redirection warnings, the Nx version warning and the missing-tool check.

- `taskInvocation` (`nx-rust/src/executors/task.ts`) calls `requireTool` for `audit` (cargo-audit) and `deny` (cargo-deny) after the other checks and before cargo runs. The task's `PATH` and `CARGO_HOME` decide. A missing tool fails the task with `<project>:<target>: ` and the message of `missingToolMessage`, whose `neededBy` is "the <target> target of the Cargo workspace in <folder>", with the target's own name. The other tools of the table have no targets yet; their issues add the check.
- `runTask` prints the warning of `nxVerdictFor` (a newer Nx with `NX_RUST_ALLOW_UNSUPPORTED_NX=true`) before the project's warnings.
- `CargoWorkspace.warnings` (`discovery.ts`) holds the warnings about an included file that is no valid TOML, a configuration file outside the repository with `[patch]` or `paths` (for every workspace it names) and a redirected crate that `cargo metadata` fails for (for every workspace whose table redirects to it). `cacheContext` gives them to every project of the workspace, and discovery still prints them once.
- Tests: `missing-tools.spec.ts` runs `rust:audit` and `rust:deny` through the real Nx with an empty `PATH` and Cargo home (`ToolFolders`). The task fails with the message, cargo is not called and nothing is installed. As the positive control, a stand-in for the tool makes the next run call cargo. `executors.spec.ts` gives `audit` and `deny` stand-ins on `PATH` wherever it checks their cargo arguments, including locked mode. The stale-`Cargo.lock` check of `deny` in locked mode runs only where cargo-deny is installed and is an `it.todo` otherwise; cargo-deny is installed neither on this machine nor in CI, so it did not run. `compatibility.spec.ts` checks the Nx warning at task start with the daemon on and off, and that a supported Nx prints none. `redirections.spec.ts` checks which projects carry each redirection warning, and that the warning for the outside configuration appears in tasks of both workspaces with the daemon on. The e2e suite runs `rust:audit` through the installed plugin without the tool.
- Mutation checks: without the task-start Nx warning, the two new compatibility tests fail; without the workspace warnings in `cacheContext`, the four new redirection checks fail.
- Mara: `VER-SETUP` now names the task-start Nx warning and the redirection warnings. The status note of `setup.mara.md` now says what is done, and leaves the `targetDefaults` warnings to nxr-rxzgbq.

Checks run, on the branch with `origin/main` at 6f9f0ea (#48) merged in: `pnpm nx run-many -t build lint test --skip-nx-cache` (749 passed, 1 todo), `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e --skip-nx-cache` (28 passed), `mara schema validate` and `mara project validate` (valid, 0 errors and 0 warnings), `zban check`.

Review round: the tool lookup in `optional-tools.ts` now resolves a relative `PATH` entry and a relative `CARGO_HOME` against the folder where cargo runs, as cargo and the operating system do. An empty `PATH` entry stands for that folder, and an unset `PATH` searches nothing. `missing-tools.spec.ts` checks both cases through the real Nx: a stand-in in the repository root's `tools` fails the task, and one in `rust/tools` passes it, as plain cargo would. A unit test covers the relative Cargo home. With the old lookup restored, the two new tests fail. A cache hit runs no executor and so prints no warning that arose after the task was stored; that is filed as nxr-w627dj.
