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
