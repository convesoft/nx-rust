---
title: Fail a task whose tool is missing, and repeat the Nx version warning at task start
status: todo
type: feature
parent: nxr-w9qa5f
blocked_by:
  - nxr-kmdpgj
discovered_from: nxr-q6cxt3
created_at: 2026-11-13T15:26:16Z
---

Goal: a task that runs a tool which is not installed fails before cargo runs, with the message that `DES-DIAGNOSTICS` (`nx-rust/docs/setup.mara.md`) asks for, and the warning for an unsupported Nx under `NX_RUST_ALLOW_UNSUPPORTED_NX` also appears where the daemon hides graph-time output. Implements the task-time rows of `DES-DIAGNOSTICS` for missing tools and its "Warnings where they are seen" paragraph for that warning, under `REQ-DIAGNOSTICS` and `ADR-V1-SCOPE`. Checked by `VER-SETUP`.

Context: nxr-q6cxt3 built the check without the executor, which did not exist yet. `requireTool(id, neededBy, context)` in `nx-rust/src/tools/optional-tools.ts` throws a `MissingToolError` whose message names the tool, what needs it and how to get it, from the same table that `init` reports; `test/missing-tools.spec.ts` checks it for every tool. `ToolContext.folder` names the folder whose toolchain counts for the wasm target. The Nx verdict comes from `nxVerdictFor(workspaceRoot, env)` in `nx-rust/src/compatibility/nx-version.ts`.

- [ ] Call `requireTool` from the executors at the start of each task that runs a tool of the table (`audit`, `deny`, and the targets and settings that later issues add), before cargo runs, so that the task fails and no success is cached. The executors of nxr-kmdpgj start every task in `runTask` (`nx-rust/src/executors/task.ts`), which turns a `TaskError` into the task's message; `audit` and `deny` reach cargo today and fail with its message for an unknown command, which the test "runs the workspace project's targets in the workspace root" in `nx-rust/test/executors.spec.ts` expects
- [ ] The `audit` and `deny` case of `VER-TARGETS`: with cargo-audit or cargo-deny removed from `PATH`, the task fails with the missing-tool message
- [ ] Name the target or setting and the crate or workspace in `neededBy`, as `DES-DIAGNOSTICS` asks
- [ ] Print the warning of an unsupported Nx with `NX_RUST_ALLOW_UNSUPPORTED_NX=true` again from the executor at the start of each task
- [ ] Print the graph-time warnings about redirections again from the executor at the start of each task of the workspace they concern (`DES-DIAGNOSTICS`, "Warnings where they are seen", and its rows for `ADR-REDIRECTION-EDGES` and `DES-METADATA-REPORT`): a configuration file outside the repository with `[patch]` or `paths`, an included file that is no valid TOML, and a redirected crate that `cargo metadata` fails for. Graph creation prints them from `CargoDiscovery.warnings` (nxr-p5ybc0), which holds plain messages without the workspace they concern
- [ ] Tests: for each tool, removing it from `PATH` and running a task that needs it fails with that message, and nothing is installed (`VER-SETUP`, fifth paragraph); hide installed tools with an empty `PATH` and Cargo home (`ToolFolders` in `nx-rust/test/harness`) and install none
- [ ] End-to-end: one such task through the installed plugin

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
