---
title: The cached result of the e2e target ignores changes to the end-to-end setup scripts and the verdaccio configuration
status: todo
type: bug
priority: low
tags:
  - tests
discovered_from: nxr-3h5eg2
created_at: 2026-11-13T17:41:43Z
---

Goal: `pnpm nx e2e nx-rust-e2e` runs the suite again when the files its global setup and teardown use change, instead of replaying a cached result.

Found while working on nxr-3h5eg2 on 13 November 2026, with Nx 24.0.6. The `e2e` target of `nx-rust-e2e`, inferred by `@nx/jest/plugin`, takes its inputs from the project root and its dependencies. `nx-rust-e2e/jest.config.cts` runs `tools/scripts/start-local-registry.ts` and `stop-local-registry.ts` as global setup and teardown, and they use `tools/scripts/local-registry.ts`, the `local-registry` target in the root `project.json` and `.verdaccio/config.yml`. None of these is an input, so a change to them alone keeps the cache key and Nx replays the last result. Checking such a change needs `--skip-nx-cache`, as nxr-3h5eg2 did.

- [ ] Add the files the global setup and teardown use to the inputs of the `e2e` target, for example in `nx-rust-e2e/project.json`
- [ ] Show that changing `tools/scripts/local-registry.ts` alone makes `pnpm nx e2e nx-rust-e2e` run the suite rather than replay it
