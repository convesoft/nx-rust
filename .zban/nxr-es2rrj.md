---
title: Build a task's dotenv environment in one place, with the dotenv check before the expansion
status: todo
type: task
priority: deferred
tags:
  - deferred
  - backlog
related:
  - nxr-c63t0r
  - nxr-vwpjg2
  - nxr-gcknzm
discovered_from: nxr-e2z8sz
created_at: 2026-11-21T18:45:27Z
---

Goal: every executor that rebuilds a task's dotenv layer goes through one function in `task-env.ts` that reads the task's dotenv files once and runs the dotenv check before anything expands them (`DES-BATCH`, "Dotenv files").

Context: finding 2 of the architecture audit after 0.6 (21 November 2026, at 54adf17). Wave: seam. It joins three open backlog issues, which this seam would settle or make small: nxr-c63t0r (the publish executor rebuilds dotenv layers in a batch but never calls `dotenvProblem`; whether it should is a question for the maintainer), nxr-vwpjg2 (a batch builds the layer before the check, so a runaway expansion can exhaust the batch process first) and nxr-gcknzm (the vault variables that Nx's wrapper leaves in the process). What the audit found:

- `nx-rust/src/executors/batch.ts` (about lines 127-169) calls `environmentOf(task)`, which expands the files, before `prepareTask` runs `dotenvProblem`; each task's files are parsed three times (in `dotenvDefinitions`, inside Nx's `loadAndExpandDotEnvFile`, and in `dotenvProblem`);
- `nx-rust/src/executors/release-publish/executor.ts` (about lines 43-127) and `nx-rust/src/release/publish.ts` build the same layers without the check;
- the single-task wrapper `withoutUnloadedRootValues(cargoTaskEnvironment(...))` is copied in `task.ts`, `coverage-baseline.ts` and `release-publish/executor.ts`, and `taskEnvironments` with `withProjectRoot` in `batch.ts` and `release-publish/executor.ts`;
- `dotenvOrigins` in `nx-rust/src/release/publish-environments.ts` (about lines 306-319) reads a task's dotenv files again although `dotenvOf` caches them.

- [ ] One function in `task-env.ts` for the single task and one for a batch, which read the files once, check, then expand; route `batch.ts`, `task.ts`, `coverage-baseline.ts` and the publish executor through them
- [ ] Take the maintainer's answer to nxr-c63t0r before the publish executor starts refusing files it accepts today
- [ ] Close or update nxr-vwpjg2 and nxr-gcknzm with what this settles

Done when: the copies are gone, the four dotenv specs pass as CI runs them, and `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e`, `pnpm nx format:check --all` and the Mara validation pass.
