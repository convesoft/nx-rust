---
title: Unify private nx/src/* loaders into one bridge and fix .nx/installation resolution
status: done
type: bug
parent: nxr-e2z8sz
created_at: 2026-11-20T10:24:40Z
closed_at: 2026-11-20T13:12:03Z
---

Goal: every private `nx/src/*` import goes through one shared, typed internal bridge that resolves Nx consistently from the repository (including `.nx/installation`).

Context: private Nx modules (`devkit-internals`, `project-nodes-manager`, `package-json`, `project-json`, `task-env`, `hash-plan-inspector`, `task-hasher`, `workspace-context`, `native`, `retrieve-workspace-files`, `get-plugins`) are currently loaded in 7+ files with duplicated helpers (`RISK-UPSTREAM-CHANGES`, `REQ-COMPATIBILITY`). That duplication caused resolution inconsistencies: `nx-rust/src/graph/target-defaults.ts`, `nx-rust/src/graph/visibility.ts`, and `nx-rust/src/generators/init/graph-check.ts` omit `.nx/installation` when resolving from `workspaceRoot`, and `nx-rust/src/executors/nx-command.ts` resolves `nx/package.json` from the plugin's own module path instead of the repository root.

- [x] Introduce a single shared `resolveFromRepository` helper checking `[join(workspaceRoot, ".nx", "installation"), workspaceRoot]` with fallback to the plugin's resolution
- [x] Consolidate private `nx/src/*` loaders and shape-check guards behind a unified internal bridge module
- [x] Migrate `nx-internals.ts`, `target-defaults.ts`, `visibility.ts`, `nx-glob.ts`, `graph-check.ts`, `task-env.ts`, `nx-task-files.ts`, `affected-inputs.ts`, `affected-run.ts`, and `nx-command.ts` to use the shared bridge
- [x] Add unit tests covering resolution from `.nx/installation` and repository root as well as missing or changed internal exports

Done when: no file outside the bridge calls `require.resolve("nx/...")` directly, tests for `.nx/installation` resolution pass, and `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e`, and `pnpm nx format:check --all` pass.


## Summary of Changes

- Added `nx-rust/src/compatibility/nx-bridge.ts` as the single typed internal bridge for `resolveFromRepository`, `nx/package.json` lookups (`readNxPackageVersion`, `loadNxYargsParser`), Nx dependency lookups (`loadNxDependency`, `readNxDependencyVersion`), and all 12 private `nx/src/*` module loaders with shape-check guards and structured `NxBridgeError` failures.
- Migrated `nx-version.ts`, `nx-internals.ts`, `target-defaults.ts`, `visibility.ts`, `nx-glob.ts`, `graph-check.ts`, `task-env.ts`, `nx-task-files.ts`, `affected-inputs.ts`, `affected-run.ts`, `nx-command.ts` (passing `workspaceRoot` through `preTasksExecution`, `commandRecords`, `excludesTaskDependencies`, `parseAsNx`, `task-options.ts`, and `task.ts`), and `dotenv-check.ts` so no file outside `nx-bridge.ts` calls `require.resolve("nx/...")` or loads private `nx/src/*` modules directly. Verified `test-mode.ts` does not load Nx (it only references `nx/src/utils/is-ci` in a comment).
- Fixed `.nx/installation` resolution in `target-defaults.ts`, `visibility.ts`, and `graph-check.ts`, and fixed `nx-command.ts` to resolve `nx/package.json` (and `yargs-parser`) from the repository root (`.nx/installation` first) instead of the plugin's own module path.
- Updated `RISK-UPSTREAM-CHANGES` in `nx-rust/docs/decisions.mara.md` to reflect all private `nx/src/*` modules routed through the bridge and their resolution order.
- Added `nx-rust/test/nx-bridge.spec.ts` covering real directory layouts under `$TMPDIR` (`.nx/installation/node_modules/nx`, root `node_modules/nx`, fallback when absent, missing subpath and unexported/unreadable `package.json` handling in Node.js) and missing/changed export shape checks across every bridge loader.

## Decisions made

- Placed the bridge at `nx-rust/src/compatibility/nx-bridge.ts` alongside `nx-version.ts` so every layer (`compatibility`, `graph`, `generators`, `executors`) can import it without circular dependencies.
- In `resolveFromRepository`, preserved `nx-version.ts`'s rule of never masking non-`MODULE_NOT_FOUND` errors (such as `EACCES` or `ERR_PACKAGE_PATH_NOT_EXPORTED`), and additionally refused to fall back to the plugin's peer dependency when `nx/package.json` resolves from the repository but a private `nx/...` subpath is missing from that `nx` package, preventing silent mixing of two Nx versions.
- Used selective key validation on multi-consumer modules (`loadDevkitInternals`, `loadRetrieveWorkspaceFiles`, `loadWorkspaceContext`, `loadTaskEnv`) so each caller checks only the exports it requires in the exact order its diagnostics expect, and kept `NxBridgeError` structured so every caller preserves its existing diagnostic wording verbatim.
- Cached `yargs-parser` per resolved `nx/package.json` path rather than in a single process-wide variable so different repositories resolve their own `nx`'s `yargs-parser`.

## Checks run

- `pnpm nx run-many -t build lint test` (70/70 test suites passed, 2003 passed, 62 skipped, 6 todo)
- `pnpm nx e2e nx-rust-e2e` (27/27 tests passed)
- `pnpm nx format:check --all` (passed)
- `mara schema validate` and `mara project validate` (`valid: true`, `evaluation_complete: true`, 0 diagnostics; confirmed `@mara implements` links via `mara related`)
- `zban check` (passed)
