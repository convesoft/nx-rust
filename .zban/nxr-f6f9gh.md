---
title: A failed end-to-end global setup leaves the local registry running, and the next run hangs
status: todo
type: bug
tags:
  - tests
discovered_from: nxr-rq5vqd
created_at: 2026-11-13T14:16:59Z
---

Goal: when the end-to-end global setup fails after it started the local registry, the registry stops, and the next `pnpm nx e2e nx-rust-e2e` in the same checkout runs normally.

Found while working on nxr-rq5vqd on 13 November 2026, with Nx 24.0.6, Jest 30.3 and pnpm 12.18.0 on Linux.

`tools/scripts/start-local-registry.ts` starts the registry, then calls `releaseVersion` and `releasePublish`. The registry is stopped only by `global.stopLocalRegistry` in `tools/scripts/stop-local-registry.ts`, Jest's global teardown, which Jest does not run when the global setup throws. Observed sequence:

1. A run failed in the global setup after a successful publish: `releasePublish` threw `DB transaction error: SqliteFailure(... "FOREIGN KEY constraint failed")` from the Nx daemon's `RECORD_TASK_RUNS`, while recording task history in the task database Nx 24 shares between the checkouts of a workspace (`~/.nx/<id>/databases`). The cause of that error was not established, and the next run did not hit it.
2. Its `nx run @convesoft/nx-rust-source:local-registry` and the verdaccio below it kept running, reparented to the user's init and listening on 4873.
3. The next run in the same checkout printed nothing after the plugin build for over ten minutes. Its own `nx run @convesoft/nx-rust-source:local-registry` waited in `ep_poll` and started no verdaccio: it neither moved to another port, as Nx's verdaccio executor does when another checkout holds 4873, nor failed.
4. After the orphaned processes were stopped, a new run passed.

- [ ] Stop the registry when the global setup fails after starting it, for example by stopping it in a `try`/`catch` around the release calls and rethrowing
- [ ] Find out why the second run waits rather than failing or taking another port, and make it fail with a clear message if it still cannot start a registry
- [ ] Show that a run whose global setup throws after the registry started leaves no registry process behind, and that the next run passes
