---
title: Something writes into a fixture's socket folder after its failed graph creation returned
status: done
type: bug
priority: low
tags:
  - tests
discovered_from: nxr-er7ve6
created_at: 2026-11-13T19:50:11Z
closed_at: 2026-11-14T10:40:49Z
---

Goal: when a fixture command ends, no process that it started still runs, so that removing the fixture removes everything it used.

Found while working on nxr-er7ve6 on 13 November 2026, with Nx 24.0.6 and Node 26.12 on Linux, in full unit-test runs with three Jest workers. Each fixture's Nx keeps its sockets in a folder of its own (`NX_SOCKET_DIR`), which `FixtureWorkspace.remove()` deletes with `rmSync(folder, { recursive: true, force: true })`. In one to seven fixtures per run, the folder still existed right after that call returned without an error. A logged case: `targetNames fails graph creation for a key that names no inferred target, listing those that can be renamed` (`configuration.spec.ts`), whose `remove()` came 517 ms after `create()`; another came from the graph-creation errors of `configuration.spec.ts` through `loadFixtureGraph`. Both are graph creations that fail. A plugin worker that outlives the failed `inspect-workspace.cjs` and creates a socket while the folder is being removed would explain it; that is not established. The same 40 failed graph creations in a row, without other workers, left nothing. The end of the test run now removes such folders (`endTestRun`).

- [x] Find which process writes into the socket folder after the command returned, and whether it keeps running and for how long
- [x] If it is a plugin worker of a failed graph creation, make the harness end it before the command returns, or wait for it in `remove()`

Done when: the cause is recorded here, a full unit run leaves no fixture socket folder behind before the end of the run, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Summary of Changes

Cause: nothing writes into the folder. A plugin worker removes its own socket after the command returned, and that removal races with `remove()`. Nx starts plugin workers detached and unref'd. A worker stops when the connection to its `nx` process ends, and on that `end` event it unlinks its socket and exits (`plugin-worker.js`), up to about a second after the command returned. A daemon behaves the same after `nx daemon --stop` has returned, and removes the whole socket folder, which is its `NX_SOCKET_DIR`. Node 26.12's `rmSync(folder, { recursive: true, force: true })` returns without an error but leaves the folder, emptied, when another process removes one of its entries at the same moment: reproduced in 2 and 3 of 200 rounds of a folder of 50 files that a second process unlinked concurrently. Nx also creates the folder again for any process that asks it for a socket path after it is gone (seen when a daemon's stop removed the folder and the next command recreated it).

On `main` as it is now (cd8c0fd), since pull request #58, a full unit run had plugin workers in 54 of 843 fixture socket folders: those of the tests with `pluginWorkers` and of the daemon tests. That run left no folder behind, neither right after `remove()` nor at the end of the run. The race was still live, though. In 8 fixtures a worker or daemon was still alive when `remove()` ran, all gone within a second. In many worker fixtures the worker unlinked its socket only 4 to 6 ms before the harness removed the folder, among them the failed graph creation of `a pluginVersion that the plugin did not set fails graph creation from another plugin`.

Fix, in the harness only: `FixtureWorkspace.remove()` now waits until the socket folder holds no entry before it deletes it, and repeats the deletion while the folder is still there, for 5 seconds at most (`removeSocketFolder` in `nx-rust/test/harness/workspace.ts`). A folder without a socket goes at once. A new test in `fixture-workspace.spec.ts` stands in for a worker that unlinks its socket 300 ms later; it fails with the old `remove()` and passes with the new one. `nx-rust/test/README.md` says so.

Measurement, one full unit run each, three Jest workers, on a machine shared with other agents' test runs:

- Before, on `main` (cd8c0fd): 266 s wall time, Nx run duration 4 min 25 s, load average rising from 9 to 26.
- After, with the fix: 217 s wall time, Jest time 214 s, load average 7 to 10. Across the whole run `remove()` waited 401 ms: 323 ms in the new test and 10 ms in the failed graph creation named above, where a worker still held its socket. No fixture socket folder was left after `remove()` or at the end of the run.

The difference between the two comes from the load. The waits add under half a second to the whole run.

Checks run: `pnpm nx run-many -t build lint test` (pass, 1153 tests passed, 1 todo), `pnpm nx format:check --all` (pass), `zban check` (pass), and the full unit runs before and after described above. The end-to-end suite was not run: it does not use `FixtureWorkspace`.
