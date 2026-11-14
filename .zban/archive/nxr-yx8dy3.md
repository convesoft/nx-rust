---
title: A full unit-test run warns that more than ten exit listeners were added to a process
status: cancelled
type: task
priority: low
tags:
  - tests
discovered_from: nxr-3tffj9
created_at: 2026-11-14T15:02:29Z
closed_at: 2026-11-14T15:04:58Z
---

Goal: a full unit-test run prints no `MaxListenersExceededWarning`, or the warning is shown to be harmless and silenced where it arises.

Context: every full run of `pnpm nx test @convesoft/nx-rust` on 14 November 2026, on `main` be233c8 and with the change of nxr-3tffj9, printed `MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 11 exit listeners added to [process]. MaxListeners is 10.` once. It comes from the process that `jest` starts, Jest's main process or a worker, and the repository's own code adds no `exit` listener (the only `process.on` in the harness is the signal forwarding of `log-cargo.cjs`). Who adds them is not known: the global setup, ts-jest, Nx code that the harness loads into Jest, or Jest itself.

- [ ] Run the unit tests with `NODE_OPTIONS=--trace-warnings` and find the code that adds the listeners
- [ ] Remove the leak if there is one, or record why the listeners are expected

Done when: the cause is recorded here, a full unit run prints no such warning or the reason it stays is recorded, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Reasons for Cancelling

Not worth a task of its own (the maintainer's rule for by-products, 14 November 2026). The warning is printed once per full run by a process that `jest` starts; by its process id, the lowest of them, it is Jest's main process. Nothing in the repository adds an `exit` listener: the only `process.on` in the harness is the signal forwarding of `log-cargo.cjs`, which runs in a process of its own. The warning changes no result: every run that printed it passed with the same tests. Look at it again only if the count of listeners grows or a run hangs at exit.
