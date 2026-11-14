---
title: The cached result of the e2e target ignores changes to the end-to-end setup scripts and the verdaccio configuration
status: done
type: bug
priority: low
tags:
  - tests
discovered_from: nxr-3h5eg2
created_at: 2026-11-13T17:41:43Z
closed_at: 2026-11-14T10:13:42Z
---

Goal: `pnpm nx e2e nx-rust-e2e` runs the suite again when the files its global setup and teardown use change, instead of replaying a cached result.

Found while working on nxr-3h5eg2 on 13 November 2026, with Nx 24.0.6. The `e2e` target of `nx-rust-e2e`, inferred by `@nx/jest/plugin`, takes its inputs from the project root and its dependencies. `nx-rust-e2e/jest.config.cts` runs `tools/scripts/start-local-registry.ts` and `stop-local-registry.ts` as global setup and teardown, and they use `tools/scripts/local-registry.ts`, the `local-registry` target in the root `project.json` and `.verdaccio/config.yml`. None of these is an input, so a change to them alone keeps the cache key and Nx replays the last result. Checking such a change needs `--skip-nx-cache`, as nxr-3h5eg2 did.

- [x] Add the files the global setup and teardown use to the inputs of the `e2e` target, for example in `nx-rust-e2e/project.json`
- [x] Show that changing `tools/scripts/local-registry.ts` alone makes `pnpm nx e2e nx-rust-e2e` run the suite rather than replay it

## Summary of Changes

`nx-rust-e2e/project.json` gives the `e2e` target, after the inputs that `@nx/jest/plugin` infers (`"..."`), `{workspaceRoot}/tools/scripts/**/*`, `{workspaceRoot}/.verdaccio/**/*` and `{workspaceRoot}/project.json`, the root project file that holds the `local-registry` target the global setup runs. The plugin already listed `start-local-registry.ts` and `stop-local-registry.ts`. `local-registry.ts`, `registry.d.ts`, `.verdaccio/config.yml` and the root `project.json` were missing, which `pnpm nx show target inputs nx-rust-e2e:e2e --check …` showed before the change and no longer shows. `nx-rust/test/harness/test-run.ts`, which the setup imports, was already an input through `^production` of `@convesoft/nx-rust`.

Checks, with `NX_DAEMON=false` and this checkout's own Nx cache:

- Before: `pnpm nx e2e nx-rust-e2e` on the configuration of `origin/main` (ee7cf38) ran and passed (30 tests). With nothing changed but a comment line appended to `tools/scripts/local-registry.ts`, the same command printed `nx run nx-rust-e2e:e2e  [local cache]` and replayed the result.
- After: a first run passed (30 tests), and the next one replayed both tasks from the cache. With the same comment line appended, the command printed `nx run nx-rust-e2e:e2e` without `[local cache]` and ran the suite (30 passed). Without the comment line it replayed the earlier result again.
- `pnpm nx run-many -t build lint test` (35 suites, 1127 tests passed, 1 todo), `pnpm nx format:check --all`, a final `pnpm nx e2e nx-rust-e2e` on the tree merged with `origin/main` cd8c0fd (30 passed) and `zban check` pass. No Mara item changed; `mara schema validate` and `mara project validate` report valid.
