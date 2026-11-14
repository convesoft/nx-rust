---
title: No Nx target lints or type-checks the scripts in tools/scripts
status: done
type: task
priority: low
tags:
  - tests
discovered_from: nxr-3h5eg2
created_at: 2026-11-13T17:41:49Z
closed_at: 2026-11-14T10:14:00Z
---

Goal: `pnpm nx run-many -t build lint test` checks the end-to-end setup scripts in `tools/scripts/` as it checks the plugin.

Found while working on nxr-3h5eg2 on 13 November 2026, with Nx 24.0.6 and oxlint 1.75. The root project `@convesoft/nx-rust-source` has only the `local-registry` target, so no `lint` target covers `tools/scripts/`. Running `pnpm exec oxlint tools/scripts` reports `typescript(triple-slash-reference)` errors for the `/// <reference path="registry.d.ts" />` lines in `start-local-registry.ts` and `stop-local-registry.ts`. Type errors also show up only when Jest compiles the global setup during `pnpm nx e2e nx-rust-e2e`, with the non-strict options of `nx-rust-e2e/tsconfig.spec.json`. In nxr-3h5eg2, a narrowing that passed `tsc --strict` failed there and stopped the suite before any test ran.

- [x] Give `tools/scripts/` a lint target and a type check with the options Jest uses, and fix or justify what they report

## Summary of Changes

The root project `@convesoft/nx-rust-source` has two new targets in `project.json`:

- `lint` uses `@nx/oxlint:lint`, the executor that `@nx/oxlint` infers for the other projects, with `lintFilePatterns: ["tools/scripts"]` and cached inputs (the folder, the root `.oxlintrc.json`, the ignore files and `oxlint`). The plugin infers no target for a root project without a `src` or `lib` folder, so the target is declared. In a `run-many` batch it reports only files in `tools/scripts`.
- `typecheck` runs `tsc -p tools/scripts/tsconfig.json`. The new `tools/scripts/tsconfig.json` extends `nx-rust-e2e/tsconfig.spec.json`, the configuration Jest compiles the global setup and teardown with, and adds `noEmit` and the scripts. Like Jest, it also checks `nx-rust/test/harness/test-run.ts`, which the setup imports. Its inputs cover the scripts, the e2e TypeScript configuration, `tsconfig.base.json`, the TypeScript of `nx-rust/` and the type packages.
- `lint` depends on `typecheck`, so `pnpm nx run-many -t build lint test` runs both. No package script or CI step was added.

What they reported: oxlint the two `typescript(triple-slash-reference)` errors, tsc nothing. The `/// <reference path="registry.d.ts" />` lines are gone. `tools/scripts/tsconfig.json` includes `registry.d.ts`. `nx-rust-e2e/tsconfig.spec.json` includes `../tools/scripts/*.d.ts`, as it already includes `src/**/*.d.ts`, so Jest's type check of the global setup still sees the declaration of `global.stopLocalRegistry`. Every end-to-end run after the change passed its global setup.

Checks:

- With a triple-slash line put back temporarily, `pnpm nx run @convesoft/nx-rust-source:lint` failed with the oxlint error.
- With `export const n: number = "x";` appended temporarily, `typecheck` failed with TS2322 and `lint` did not run. Both were reverted.
- `pnpm nx run-many -t build lint test` (`@convesoft/nx-rust-source:typecheck` and `:lint` included), `pnpm nx format:check --all`, the final `pnpm nx e2e nx-rust-e2e` and `zban check` pass.
