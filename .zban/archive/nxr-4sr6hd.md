---
title: Avoid mutating global process.env when building batch task environments
status: done
type: task
parent: nxr-e2z8sz
blocked_by:
  - nxr-gtxq18
created_at: 2026-11-20T10:24:43Z
closed_at: 2026-11-20T15:07:21Z
---

Goal: build each batch task's dotenv environment without mutating the batch worker's global `process.env`.

Context: `taskEnvironments` in `nx-rust/src/executors/task-env.ts` temporarily writes `process.env[name] = shieldValue` (`"\u0001@convesoft/nx-rust"`) around calling Nx's `getTaskSpecificEnv` and restores it in `finally` (`DES-BATCH`, `VER-BATCHING`). While `getTaskSpecificEnv` is currently synchronous, mutating global `process.env` with a sentinel string is fragile if any async work runs concurrently in the batch process.

- [x] Check whether the task dotenv layer can be constructed on a local `{ ...process.env }` clone using the installed Nx's `getEnvFilesForTask`, `dotenv.parse`, and `dotenv-expand` (plus root unloading), matching `getTaskSpecificEnv` without mutating `process.env`
- [x] Replace the global `process.env` shield mutation in `nx-rust/src/executors/task-env.ts`
- [x] Verify equivalence with single-task runs across `VER-BATCHING` and dotenv tests

Done when: `task-env.ts` no longer mutates `process.env` during batch environment construction, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Summary of Changes

- `nx-rust/src/executors/task-env.ts`: the new `taskDotenvLayer` builds each task's dotenv layer on a copy of the batch process's environment, using the Nx functions that `getTaskSpecificEnv` itself calls. All of them take the environment as an argument: `unloadDotEnvFile` for `rootDotenvFiles`, then, where `NX_LOAD_DOT_ENV_FILES` is `true`, `loadAndExpandDotEnvFile` over the files that `getEnvFilesForTask` names. The shield value is set in the copy. `taskEnvironments` keeps its signature, and the plugin no longer writes to `process.env` while it builds batch task environments. `withoutUnloadedRootValues` now uses the shared `rootDotenvFiles`.
- `nx-rust/src/compatibility/nx-bridge.ts`: `NxTaskEnv` gains `loadAndExpandDotEnvFile` and drops the unused `getTaskSpecificEnv`. No new private module is loaded.
- Tests: the new `nx-rust/test/task-dotenv-layer.spec.ts` compares the layer with Nx's real `getTaskSpecificEnv` for `NX_LOAD_DOT_ENV_FILES` true, false and unset, with and without a configuration, and for a target in a target group with an atomized target. It runs `taskEnvironments` under a `process.env` proxy that records writes and checks that, for dotenv files without a vault, none are made and the shield value never reaches cargo's environment. A tripwire test compares the source text of Nx's `getTaskSpecificEnv`, `unloadDotEnvFiles` and `loadDotEnvFilesForTask` in the installed `nx/src/tasks-runner/task-env.js` with recorded text, and its failure says what to bring in line. `dotenv-equivalence.spec.ts` now builds the single-task layer with Nx's real `getTaskSpecificEnv` and the batch layer with `taskDotenvLayer`. The fake `.nx/installation` modules in `nx-bridge.spec.ts` were updated to match.
- Mara: `DES-BATCH` ("Dotenv files") records the design, the three facts that the plugin repeats from Nx's wrapper and the test that guards them, the vault limit, and the alternatives not chosen. `VER-BATCHING` records the checks.
- A remaining write that is not the plugin's: with `DOTENV_KEY` set and a vault beside a task's dotenv files, dotenv 16.4.7's `_parseVault` calls `configDotenv` without `processEnv`, so Nx's `loadAndExpandDotEnvFile` sets the vault's raw `DOTENV_VAULT_<ENV>` on the live `process.env` of the process it runs in. That happens in the `nx` process for a task run on its own and in the batch process. The dotenv check refuses the vault's own task, but the variable reaches the cargo of tasks whose environment is built later, so it depends on order. A real run showed that it can differ between a batch and tasks run on their own (the batch process inherits it from the `nx` process). Recorded as a limit in `DES-BATCH` and filed as nxr-gcknzm (deferred backlog).

Checks run after the second review, after merging `main` at 01859ed: `pnpm nx run-many -t build lint test` (74 suites, 2047 tests passed), `pnpm nx e2e nx-rust-e2e` run afterwards (27 passed), the CI-env run of `task-dotenv-layer`, `dotenv-equivalence` and `nx-bridge` (22 passed), `pnpm nx format:check --all`, `mara schema validate` and `mara project validate` (valid, evaluation complete), and `zban check`. The vault behaviour was checked in a real run of a copy of the `batch-groups` fixture (see nxr-gcknzm).

## Decisions made

- The batch builds the dotenv layer with the Nx functions that `getTaskSpecificEnv` calls (`unloadDotEnvFile`, `getEnvFilesForTask`, `loadAndExpandDotEnvFile`), not with `dotenv.parse` and dotenv-expand directly. Nx's own code still chooses the files and their order and does the expansion. The plugin adds only the call order, the three root files and the `=== "true"` check, and it already hard-coded the last two in `withoutUnloadedRootValues`. A test against the real `getTaskSpecificEnv` and a tripwire on the source of its wrapper catch drift. Recorded in `DES-BATCH`.
- Rejected: Nx's `getGraphTimeDotEnvForTask`, which takes a base environment but loads files unless `NX_LOAD_DOT_ENV_FILES` is `false` (rather than only where it is `true`). It also needs the owner target, which Nx computes in `getOwnerTargetForTask`, a function it does not export. Also rejected: keeping the global write with extra checks, and computing the environments in a child process (which costs a process that loads Nx for each batch, plus the means to pass tasks and environments both ways, for what the tripwire guards). Recorded in `DES-BATCH`.
- The shield (`shieldValue` for run-dependent variables that the task's files define) stays, now set in the copy, so the behaviour is unchanged.
- The tripwire compares the exact source text of the three wrapper functions rather than a digest of the whole module. That way it trips only when the wrapper changes, and its failure shows what it found.
- The vault write that dotenv makes inside Nx's loader is recorded as a limit and is not shielded, because shielding it would change global process state as a workaround.

## For nxr-qkxcmm

- `dotenv-check.ts` still needs bounds of its own, because dotenv-expand has no limit. Now that the expansion runs on a local object, a `Proxy` around that object could observe which variables Nx's own expansion looks up, and stop it after a budget, instead of following dotenv-expand symbolically.
- The list of root dotenv files (`rootDotenvFiles` in `task-env.ts`) should be shared with the check when nxr-qkxcmm replaces it.
