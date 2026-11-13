---
title: Something writes into a fixture's socket folder after its failed graph creation returned
status: todo
type: bug
priority: low
tags:
  - tests
discovered_from: nxr-er7ve6
created_at: 2026-11-13T19:50:11Z
---

Goal: when a fixture command ends, no process that it started still runs, so that removing the fixture removes everything it used.

Found while working on nxr-er7ve6 on 13 November 2026, with Nx 24.0.6 and Node 26.12 on Linux, in full unit-test runs with three Jest workers. Each fixture's Nx keeps its sockets in a folder of its own (`NX_SOCKET_DIR`), which `FixtureWorkspace.remove()` deletes with `rmSync(folder, { recursive: true, force: true })`. In one to seven fixtures per run, the folder still existed right after that call returned without an error. A logged case: `targetNames fails graph creation for a key that names no inferred target, listing those that can be renamed` (`configuration.spec.ts`), whose `remove()` came 517 ms after `create()`; another came from the graph-creation errors of `configuration.spec.ts` through `loadFixtureGraph`. Both are graph creations that fail. A plugin worker that outlives the failed `inspect-workspace.cjs` and creates a socket while the folder is being removed would explain it; that is not established. The same 40 failed graph creations in a row, without other workers, left nothing. The end of the test run now removes such folders (`endTestRun`).

- [ ] Find which process writes into the socket folder after the command returned, and whether it keeps running and for how long
- [ ] If it is a plugin worker of a failed graph creation, make the harness end it before the command returns, or wait for it in `remove()`

Done when: the cause is recorded here, a full unit run leaves no fixture socket folder behind before the end of the run, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
