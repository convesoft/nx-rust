---
title: A unit-test run still peaks above 2 GB with three Jest workers
status: todo
type: task
priority: low
tags:
  - tests
discovered_from: nxr-er7ve6
created_at: 2026-11-13T19:50:11Z
---

Goal: a full unit-test run on a machine with many cores holds well under 2 GB at its peak, counting every process it starts, without slowing CI.

Found while working on nxr-er7ve6 on 13 November 2026 (32 cores, 14 GB of RAM, Nx 24.0.6, Jest 30.3, Node 26.12). With the unit tests capped at three Jest workers, three full runs of `pnpm nx test @convesoft/nx-rust` peaked at 2.34, 2.44 and 2.63 GB of anonymous memory in their cgroup (sampled every 0.5 s), each about 4 s after the start. At the peak of the last run:

- the three Jest workers held 362 to 366 MB each and Jest's main process 324 MB;
- six Nx processes of fixtures held 191 to 206 MB each, and two `nx run` commands 168 MB each;
- the outer `nx test` held 183 MB.

Fewer workers would slow CI, where Jest's default on the 4-core runner is three. Where the Jest workers' memory goes is not established: ts-jest builds a TypeScript program with type information in each worker, which `isolatedModules` would avoid at the cost of type errors in tests no longer failing them.

- [ ] Find what the Jest workers hold at the start of a run, and what else can be shared or started later
- [ ] Decide with the maintainer whether a change such as type-checking the tests once, outside Jest, is wanted, and record it
- [ ] Measure one full run's peak before and after and record both here

Done when: the measurements are recorded here, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Notes from nxr-28k2vk (14 November 2026)

Measured while finding out whether one long-lived Nx process per fixture could answer the harness's graph and hash requests (`EVD-NX-24-PROCESS-STATE`), on `main` e8958bb, with other test runs on the machine:

- A fresh Nx process of a fixture, hashing six tasks of `subfolder-workspace`, peaked at about 250 MB of resident memory (`ru_maxrss`), with and without `--enable-source-maps`, which the harness sets for the compiled plugin, so source maps are not what makes these processes large. With `MALLOC_ARENA_MAX=2` it peaked at about 245 MB.
- A process that stays up and answers request after request grows to 400 to 475 MB after 20 to 40 requests, even with `MALLOC_ARENA_MAX=2`, and to 384 to 405 MB with V8's semi-space limited to 1 or 2 MB as well. A run of one spec file with such a session peaked about 130 to 220 MB higher in anonymous memory than with fresh processes (`cache-keys.spec.ts`: about 1030 against 1250 MB; `declared-files.spec.ts`: 1250 against 1380 MB), so the session was left out; with three Jest workers it would have added up to about 0.6 GB to a full run's peak.
- A full unit run starts about 1670 Nx processes (867 for graph and hash requests, 800 `nx` commands) and, besides them, 4680 Node processes for the harness's cargo wrapper (nxr-3tffj9) and 1179 for the plugin's artifact folder input; each lives only for its call, so they add to the run's time more than to its peak.
