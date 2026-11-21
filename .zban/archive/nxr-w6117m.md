---
title: Split monolithic modules (target-defaults, task, publish, version-actions) by concern
status: done
type: task
parent: nxr-e2z8sz
blocked_by:
  - nxr-gtxq18
  - nxr-gp1awx
  - nxr-hjpc99
  - nxr-k63csj
  - nxr-3f5wqp
  - nxr-4sr6hd
  - nxr-qkxcmm
  - nxr-aqgka5
  - nxr-yfh7zh
  - nxr-1tmme6
related:
  - nxr-2vzmt5
created_at: 2026-11-20T10:24:50Z
closed_at: 2026-11-21T15:15:00Z
---

Goal: break up the four largest monolithic modules into focused, cohesive submodules with clear boundaries and no behaviour changes.

Context: four files account for over 6,300 lines and mix multiple concerns (Nx internal loading, graph/target re-simulation, validation, planning, execution, and diagnostic formatting):
- `nx-rust/src/graph/target-defaults.ts` (2,189 lines, `DES-TARGET-DEFAULT-GUARD`)
- `nx-rust/src/executors/task.ts` (1,818 lines, `DES-BATCH`, `DES-TARGETS`)
- `nx-rust/src/release/publish.ts` (1,317 lines, `DES-RELEASE`)
- `nx-rust/src/release/version-actions.ts` (1,073 lines, `DES-RELEASE`)

Also check whether `target-defaults.ts` can drop parts of its manual layer re-simulation once `nxr-2vzmt5` (native hash-plan comparison) is decided.

- [x] Split `nx-rust/src/graph/target-defaults.ts` into focused modules (e.g. layer rebuilding, diffing/validation, option origins, diagnostic formatting)
- [x] Split `nx-rust/src/executors/task.ts` into focused modules (e.g. task preparation/guards, group invocation building, cargo execution & post-checks)
- [x] Split `nx-rust/src/release/publish.ts` and `nx-rust/src/release/version-actions.ts` into focused modules (e.g. manifest/dependency checks, lockfile checks, registry/cargo invocation)
- [x] Preserve all `// @mara implements ...` markers and verify links with `mara related` and `mara project validate`

Done when: all four areas are split cleanly with preserved Mara code links, and `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all`, `mara schema validate`, and `mara project validate` pass.

## Summary of Changes

Split the four monolithic modules into focused, cohesive submodules by concern with no behaviour changes, no edits under `nx-rust/test/` or `nx-rust-e2e/`, and no edits to the protected executor files (`batch.ts`, `staged-run.ts`, `stage.ts`, `kept-files.ts`, `group-run.ts`, `input-check.ts`, `napi-build.ts`, `wasm-build.ts`). Each original module path remains the entry point and re-exports the moved names that tests and untouched modules import.

- `nx-rust/src/graph/target-defaults.ts` (2,146 -> 584 lines) split with `target-defaults-layers.ts` (647), `target-defaults-meaning.ts` (375), `target-defaults-report.ts` (370), and `target-defaults-causes.ts` (250). Updated direct imports in `generators/init/init.ts`, `graph/plugin-version.ts`, and `graph/registration.ts`.
- `nx-rust/src/executors/task.ts` (1,852 -> 756 lines) split with `task-guards.ts` (579), `group-invocations.ts` (408), and `task-execution.ts` (149). Updated direct imports in `executors/cargo/executor.ts`, `executors/lockfile/executor.ts`, `executors/run/executor.ts`, `executors/release-publish/executor.ts`, `executors/coverage-baseline.ts`, and `release/publish.ts`.
- `nx-rust/src/release/publish.ts` (1,814 -> 774 lines) split with `publish-crates.ts` (392), `publish-environments.ts` (359), `publish-messages.ts` (298), and `publish-registry.ts` (177).
- `nx-rust/src/release/version-actions.ts` (1,073 -> 600 lines) split with `version-lockfiles.ts` (308) and `version-checks.ts` (219).

Checks run (after each split and after merging `main` at `843adda`):
- `pnpm nx run-many -t build lint test`: passed after each of the four splits and after merging `main` (8/8 tasks).
- `pnpm nx e2e nx-rust-e2e`: passed (27/27 tests).
- Built package entry-point resolution check against `dist/nx-rust` (`package.json` main, all executors and batch implementations in `executors.json`, all generators in `generators.json`, and `src/release/version-actions`): passed.
- `pnpm nx format:check --all`: passed.
- `mara schema validate` and `SCIP_INDEX_CACHE=0 mara project validate`: valid schema and valid project (`valid: true`, `evaluation_complete: true`, 0 errors, 0 warnings).
- `mara related --relation implements --direction incoming --limit 100 <ID>` across all 17 Mara items linked by the four files: exact symbol parity before and after across all 28 moved declarations.
- `zban check`: passed.

## Decisions made

- Kept `target-defaults.ts` manual layer re-simulation unchanged because `nxr-2vzmt5` stays undecided in the backlog.
- Kept `prepareTask` defined directly in `nx-rust/src/executors/task.ts` and re-exported `checksAfterCargo`, `GroupInvocation`, `groupInvocations`, `PluginExecutor`, `projectWarnings`, and `TaskError` from `task.ts` so `nx-rust/test/group-run.spec.ts` (`jest.spyOn(taskModule, "prepareTask")`) and untouched sibling executor files continue to work without modification.
- Passed explicit plain state records (`CrateStore`, `DotenvStore`, `RegistryStore`, `LockfileRun`) to extracted helper functions in `publish-*.ts` and `version-*.ts` instead of introducing new wrapper classes or indirection.
