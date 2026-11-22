---
title: Check what Nx Cloud's ultracache does to Rust targets' inputs
status: done
type: task
tags:
  - spike
parent: nxr-nm0jd6
discovered_from: nxr-qv2cq5
created_at: 2026-11-13T12:05:50Z
closed_at: 2026-11-22T09:53:07Z
---

Goal: know what Nx 24's `ultracache` target setting does to the inferred Rust targets when a workspace uses Nx Cloud, and decide whether they should set `ultracache.mode` to `warn`.

`EVD-NX-24-FILE-INPUTS` records what the installed typings say: the mode defaults to `on`, where a recording of the task's reads stands in for its declared inputs and outputs; `warn` records and reports undeclared reads but hashes and caches from the declared inputs; it is Nx Cloud only and the open-source runner records nothing. Nobody has run it. If `on` replaced the declared inputs of `DES-INPUTS` (the toolchain and test-mode runtime inputs, environment inputs, `fileInputs`), keys could miss what the plugin declares on purpose (`GOAL-TRUSTED-CACHE`).

- [x] Find out, with Nx Cloud or from Nx's documentation and source, when a recording replaces declared inputs and what it records for a cargo process tree, including runtime and `env` inputs and the `always` flag on filesets
- [x] Record the result as an evidence item and update the risks and designs it concerns
- [x] Decide with the user whether inferred Rust targets set `ultracache.mode` (for example `warn`), and specify it in `DES-TARGETS` or `DES-INPUTS`

Done when: the evidence item is accepted, the user has agreed to the decision, and `mara schema validate` and `mara project validate` report `valid: true`.

## Summary of Changes

- Probed Nx 24.0.6's native `HashPlanner`, `UltracacheConfigurationStore`, `getUltracacheReport` and read `dist/src/ultracache/`, `task-io-service.js`, `forked-process-task-runner.js`, `hash-task.js` and `native/index.d.ts`. Recorded the findings in `EVD-NX-24-ULTRACACHE` (`nx-rust/docs/decisions.mara.md`): `mode: "on"` keeps `runtime`, `env`, `externalDependencies`, `ProjectConfiguration` and `always: true` filesets, but replaces all other declared file inputs (and declared outputs) with recorded IO; `forkProcessForBatch` does not call `registerTaskProcessStart` while single-task runs do unless `mode === "off"`.
- Decided with the maintainer to set `ultracache: { mode: "off" }` on every inferred Rust target rather than `warn` (avoiding both stale-cache / build-dir conflicts with `GOAL-TRUSTED-CACHE` and `ADR-RESULTS-ONLY-CACHE` and noisy `target/` write warnings / tracing overhead on `cargo`/`rustc` process trees).
- Specified the behaviour in `DES-INPUTS` (`nx-rust/docs/caching.mara.md`), implemented `target.ultracache = { mode: "off" }` in `configureCaching` (`nx-rust/src/graph/caching.ts`), and added tests in `nx-rust/test/targets.spec.ts` covering both the inferred default and manifest target-table overrides.
- Checks run: `pnpm nx run-many -t build lint`, `pnpm nx test @convesoft/nx-rust --testPathPatterns="targets|target-defaults|target-tables"`, `pnpm nx e2e nx-rust-e2e`, `pnpm nx format:check --all`, `mara schema validate`, `mara project validate`, `zban check`, and CI on the pull request.
