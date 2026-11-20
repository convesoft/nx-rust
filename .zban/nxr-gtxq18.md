---
title: Unify private nx/src/* loaders into one bridge and fix .nx/installation resolution
status: todo
type: bug
parent: nxr-e2z8sz
created_at: 2026-11-20T10:24:40Z
---

Goal: every private `nx/src/*` import goes through one shared, typed internal bridge that resolves Nx consistently from the repository (including `.nx/installation`).

Context: private Nx modules (`devkit-internals`, `project-nodes-manager`, `package-json`, `project-json`, `task-env`, `hash-plan-inspector`, `task-hasher`, `workspace-context`, `native`, `retrieve-workspace-files`, `get-plugins`) are currently loaded in 7+ files with duplicated helpers (`RISK-UPSTREAM-CHANGES`, `REQ-COMPATIBILITY`). That duplication caused resolution inconsistencies: `nx-rust/src/graph/target-defaults.ts`, `nx-rust/src/graph/visibility.ts`, and `nx-rust/src/generators/init/graph-check.ts` omit `.nx/installation` when resolving from `workspaceRoot`, and `nx-rust/src/executors/nx-command.ts` resolves `nx/package.json` from the plugin's own module path instead of the repository root.

- [ ] Introduce a single shared `resolveFromRepository` helper checking `[join(workspaceRoot, ".nx", "installation"), workspaceRoot]` with fallback to the plugin's resolution
- [ ] Consolidate private `nx/src/*` loaders and shape-check guards behind a unified internal bridge module
- [ ] Migrate `nx-internals.ts`, `target-defaults.ts`, `visibility.ts`, `nx-glob.ts`, `graph-check.ts`, `task-env.ts`, `nx-task-files.ts`, `affected-inputs.ts`, `affected-run.ts`, and `nx-command.ts` to use the shared bridge
- [ ] Add unit tests covering resolution from `.nx/installation` and repository root as well as missing or changed internal exports

Done when: no file outside the bridge calls `require.resolve("nx/...")` directly, tests for `.nx/installation` resolution pass, and `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e`, and `pnpm nx format:check --all` pass.
