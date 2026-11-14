---
title: A unit-test run still peaks above 2 GB with three Jest workers
status: done
type: task
priority: low
tags:
  - tests
discovered_from: nxr-er7ve6
created_at: 2026-11-13T19:50:11Z
closed_at: 2026-11-14T16:13:26Z
---

Goal: a full unit-test run on a machine with many cores holds well under 2 GB at its peak, counting every process it starts, without slowing CI.

Found while working on nxr-er7ve6 on 13 November 2026 (32 cores, 14 GB of RAM, Nx 24.0.6, Jest 30.3, Node 26.12). With the unit tests capped at three Jest workers, three full runs of `pnpm nx test @convesoft/nx-rust` peaked at 2.34, 2.44 and 2.63 GB of anonymous memory in their cgroup (sampled every 0.5 s), each about 4 s after the start. At the peak of the last run:

- the three Jest workers held 362 to 366 MB each and Jest's main process 324 MB;
- six Nx processes of fixtures held 191 to 206 MB each, and two `nx run` commands 168 MB each;
- the outer `nx test` held 183 MB.

Fewer workers would slow CI, where Jest's default on the 4-core runner is three. Where the Jest workers' memory goes is not established: ts-jest builds a TypeScript program with type information in each worker, which `isolatedModules` would avoid at the cost of type errors in tests no longer failing them.

- [x] Find what the Jest workers hold at the start of a run, and what else can be shared or started later
- [x] Decide with the maintainer whether a change such as type-checking the tests once, outside Jest, is wanted, and record it
- [x] Measure one full run's peak before and after and record both here

Done when: the measurements are recorded here, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Notes from nxr-28k2vk (14 November 2026)

Measured while finding out whether one long-lived Nx process per fixture could answer the harness's graph and hash requests (`EVD-NX-24-PROCESS-STATE`), on `main` e8958bb, with other test runs on the machine:

- A fresh Nx process of a fixture, hashing six tasks of `subfolder-workspace`, peaked at about 250 MB of resident memory (`ru_maxrss`), with and without `--enable-source-maps`, which the harness sets for the compiled plugin, so source maps are not what makes these processes large. With `MALLOC_ARENA_MAX=2` it peaked at about 245 MB.
- A process that stays up and answers request after request grows to 400 to 475 MB after 20 to 40 requests, even with `MALLOC_ARENA_MAX=2`, and to 384 to 405 MB with V8's semi-space limited to 1 or 2 MB as well. A run of one spec file with such a session peaked about 130 to 220 MB higher in anonymous memory than with fresh processes (`cache-keys.spec.ts`: about 1030 against 1250 MB; `declared-files.spec.ts`: 1250 against 1380 MB), so the session was left out; with three Jest workers it would have added up to about 0.6 GB to a full run's peak.
- A full unit run starts about 1670 Nx processes (867 for graph and hash requests, 800 `nx` commands) and, besides them, 4680 Node processes for the harness's cargo wrapper (nxr-3tffj9) and 1179 for the plugin's artifact folder input; each lives only for its call, so they add to the run's time more than to its peak.

## Measurements from nxr-3tffj9 (14 November 2026)

Full runs of `pnpm nx test @convesoft/nx-rust --skip-nx-cache` with `NX_DAEMON=false`, as in CI, on the machine above with Node 26.12, ts-jest 29.4.15 and TypeScript 6.0.3, each in a systemd user scope of its own whose anonymous memory, and each process's `RssAnon`, were sampled every 0.5 s. Nothing ran beside a run but the desktop and idle agent sessions.

- **Before and after nxr-3tffj9.** On `main` be233c8 two runs peaked at 2.69 GB (cold Jest cache) and 2.51 GB; with the cargo wrapper that starts no Node, two runs peaked at 2.71 and 2.75 GB. The median rose from 1.96 to 2.21 GB, and the share of samples above 2 GB from 43% to 81%: the run is 18 s shorter, and the fixtures' Nx processes held 390 to 415 MB on average instead of 240 MB, the largest of them up to 454 MB instead of 321 MB. The wrapper's Node processes held 12 to 14 MB each and 7 MB on average, so removing them could not lower the peak.
- **At the start of a run**, before a test runs Nx, each Jest worker holds 305 to 340 MB and Jest's main process about 292 MB, 1.2 GB together; the workers reach 330 to 500 MB later. In a probe test file, a Jest process with a warm transform cache held 312 to 346 MB, 195 to 215 MB of it V8 heap, with ts-jest as configured, and 101 to 113 MB, 41 to 51 MB of it heap, with ts-jest's `isolatedModules`: the TypeScript program that ts-jest keeps for type information takes about 210 MB in every Jest process, the main one included, which transforms the global setup.
- **At the peak** of 2.71 GB after the change: the three Jest workers 1155 MB (486, 340 and 329), two fixture `nx` commands 504 MB, the outer `nx test` 343 MB, Jest's main process 236 MB, a fixture's Nx daemon with its plugin worker 139 MB, two plugin workers of a fixture command 83 MB, `code --list-extensions`, which the fixture's daemon started, 37 MB, and pnpm 26 MB. Without the daemon, the outer `nx test` holds about 345 MB for the whole run.
- **With ts-jest's `isolatedModules`**, one run with a cold transform cache peaked at 2.20 GB, with a median of 1.37 GB and 1% of its samples above 2 GB; the Jest workers started at 119 to 160 MB and the main process at 71 to 84 MB. It took 185.9 s, against 180.2 s for the type-checked runs with a warm cache. `tsc --noEmit -p nx-rust/tsconfig.spec.json` type-checks the tests in 1.15 s with 385 MB, and passes with `--isolatedModules` as well.

The peak after a change decided under the second task item is still to be measured; the runs above are its "before".

## Decision (14 November 2026)

Of the options reported from nxr-3tffj9 (leave it as it is, type-check the tests once outside Jest, two Jest workers, `workerIdleMemoryLimit`), the maintainer chose "Type-check tests once, outside Jest (Recommended)". ts-jest stops building a program with type information in every Jest process: it compiles each file on its own, which ts-jest 29.4.15 does when the tsconfig it is given sets `isolatedModules`. The tests are then type-checked once per run by a cacheable `typecheck` target (`tsc --noEmit` on the spec configuration), which `lint` depends on. A type error in a test therefore still fails `pnpm nx run-many -t build lint test` and CI, without a new or renamed job.

## Measurements after the change (14 November 2026)

Two full runs of `pnpm nx test @convesoft/nx-rust --skip-nx-cache` with `NX_DAEMON=false`, each in a systemd user scope of its own, sampled every 0.5 s as above, on `main` f74f610 with the change. The first had a cold transform cache. Other agents' work ran on the machine, a load average of 6 to 13, which affects the time but not the memory of the run's own processes.

- **Peak:** 1.91 and 2.07 GB, against 2.51 and 2.69 GB before (be233c8) and 2.71 and 2.75 GB with nxr-3tffj9 (f74f610 without the change).
- **Spread:** median 1.30 and 1.37 GB (2.21 GB before); 90th percentile 1.55 and 1.61 GB (2.43 GB). Above 2 GB: none and 1 of 369 samples, against 81% of samples before.
- **Start of the run:** the Jest workers held 125 to 190 MB, against 305 to 347 MB, and Jest's main process 70 to 85 MB, against about 294 MB. The largest worker reached 340 MB, against 492 MB.
- **Time:** 191.4 s (cold transform cache) and 183.1 s by Jest's clock, against 180.2 s before on a quieter machine.
- **Type-checks:** `tsc --noEmit` takes 1.19 s and 386 MB for `nx-rust/tsconfig.spec.json` and 0.56 s and 289 MB for `nx-rust-e2e/tsconfig.spec.json`, once per run, or not at all when cached.

What holds the rest at the peaks, which both came late in the run:
- the three Jest workers, 709 MB (335, 202, 172) and 584 MB (320, 176, 88);
- fixture `nx` commands, 515 and 686 MB. In both runs `nx run core-lib:check --pluginVersion=…` in `crate-shapes` was the largest at 299 and 357 MB, with its four plugin workers at 32 to 56 MB each;
- a fixture's Nx daemon with its plugin workers, 235 and about 150 MB;
- the outer `nx test`, 95 and 345 MB (about 270 MB on average without the daemon);
- Jest's main process at 70 MB, and pnpm at 26 MB.

These peaks are moments when a daemon test and a plugin-isolation test of other workers overlap. No single process or setting stands out as a next step, so the remainder is not filed as an issue.

## Summary of Changes

Done as decided, in both projects that run ts-jest, the plugin's unit tests and the end-to-end project:
- **ts-jest without type information.** `nx-rust/tsconfig.spec.json` and `nx-rust-e2e/tsconfig.spec.json` set `isolatedModules`, which is how ts-jest 29.4.15 is told to compile each file on its own. Its `isolatedModules` transform option is deprecated, and its `transpilation` option came in 29.4.3 and was reverted in 29.4.4.
- **New `typecheck` targets.** `@convesoft/nx-rust:typecheck` and `nx-rust-e2e:typecheck` run `tsc --noEmit -p <project>/tsconfig.spec.json`. They are cacheable, and the `lint` target, inferred by `@nx/oxlint`, depends on them through `project.json`. `pnpm nx run-many -t build lint test` and the CI job "Build, lint, test and format" therefore run them, and no job changed.
- **Inputs.** They cover the TypeScript the checks read (from `tsc --listFilesOnly`), the `jest.config.cts`, the tsconfig files and `tsconfig.base.json`, plus the packages whose types they read: typescript, tslib, `@types/node`, `@types/jest`, nx, `@nx/devkit`, and `smol-toml` for the plugin. The end-to-end check also covers `nx-rust/**/*.ts`, since it reads the harness, and `tools/scripts/*.d.ts`.
- **Root project.** Its existing `typecheck` of `tools/scripts` extends the end-to-end spec configuration and so checks with `isolatedModules` too.
- **Nothing to fix.** All three configurations passed `tsc` with `isolatedModules`: no `const enum`, type re-exported without `export type` or namespace needed a change.
- **Docs.** `nx-rust/test/README.md` describes how the tests are compiled and type-checked, and `nx-rust/test/README.md` and `nx-rust/jest.config.cts` give the Jest workers' new memory. No Mara item states how tests are type-checked, so no Mara change.

Checks:
- With `const probeNumber: number = "not a number";` appended to `nx-rust/test/cargo-wrapper.spec.ts`, `pnpm nx lint @convesoft/nx-rust` failed in `typecheck` with `error TS2322: Type 'string' is not assignable to type 'number'.` and did not lint, while `nx test` still passed that spec. The same in `nx-rust-e2e/src/nx-rust.spec.ts` failed `pnpm nx lint nx-rust-e2e`. Both files were restored.
- With a private cache, both `typecheck` targets ran and then came from the cache. A change to a test file and to a source file of `nx-rust/` reran both, since the end-to-end check reads the harness; a change to `nx-rust/README.md` reran neither; a change to the end-to-end spec reran only its own.
- On the tree merged with the local `main` at c2fcb9d: `pnpm nx run-many -t build lint test` (all three `typecheck` targets before `lint`, 1146 unit tests), `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e --skip-nx-cache` (26 tests) and `zban check` passed.

The peak is 1.91 and 2.07 GB, down from 2.5 to 2.75 GB, and the median 1.30 to 1.37 GB, down from 2.21 GB. That is under but not well under 2 GB at the peak; what holds the rest is recorded above, and no concrete next step was found. The issue is closed as the decided change is in.
