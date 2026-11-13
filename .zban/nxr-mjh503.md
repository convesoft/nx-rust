---
title: No Nx target lints or type-checks the scripts in tools/scripts
status: todo
type: task
priority: low
tags:
  - tests
discovered_from: nxr-3h5eg2
created_at: 2026-11-13T17:41:49Z
---

Goal: `pnpm nx run-many -t build lint test` checks the end-to-end setup scripts in `tools/scripts/` as it checks the plugin.

Found while working on nxr-3h5eg2 on 13 November 2026, with Nx 24.0.6 and oxlint 1.75. The root project `@convesoft/nx-rust-source` has only the `local-registry` target, so no `lint` target covers `tools/scripts/`. Running `pnpm exec oxlint tools/scripts` reports `typescript(triple-slash-reference)` errors for the `/// <reference path="registry.d.ts" />` lines in `start-local-registry.ts` and `stop-local-registry.ts`. Type errors also show up only when Jest compiles the global setup during `pnpm nx e2e nx-rust-e2e`, with the non-strict options of `nx-rust-e2e/tsconfig.spec.json`. In nxr-3h5eg2, a narrowing that passed `tsc --strict` failed there and stopped the suite before any test ran.

- [ ] Give `tools/scripts/` a lint target and a type check with the options Jest uses, and fix or justify what they report
