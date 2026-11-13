---
title: A failed end-to-end global setup leaves the local registry running, and the next run hangs
status: done
type: bug
tags:
  - tests
related:
  - nxr-r1b5wf
discovered_from: nxr-rq5vqd
created_at: 2026-11-13T14:16:59Z
closed_at: 2026-11-13T15:27:18Z
---

Goal: when the end-to-end global setup fails after it started the local registry, the registry stops, and the next `pnpm nx e2e nx-rust-e2e` in the same checkout runs normally.

Found while working on nxr-rq5vqd on 13 November 2026, with Nx 24.0.6, Jest 30.3 and pnpm 12.18.0 on Linux.

`tools/scripts/start-local-registry.ts` starts the registry, then calls `releaseVersion` and `releasePublish`. The registry is stopped only by `global.stopLocalRegistry` in `tools/scripts/stop-local-registry.ts`, Jest's global teardown, which Jest does not run when the global setup throws. Observed sequence:

1. A run failed in the global setup after a successful publish: `releasePublish` threw `DB transaction error: SqliteFailure(... "FOREIGN KEY constraint failed")` from the Nx daemon's `RECORD_TASK_RUNS`, while recording task history in the task database Nx 24 shares between the checkouts of a workspace (`~/.nx/<id>/databases`). The cause of that error was not established, and the next run did not hit it.
2. Its `nx run @convesoft/nx-rust-source:local-registry` and the verdaccio below it kept running, reparented to the user's init and listening on 4873.
3. The next run in the same checkout printed nothing after the plugin build for over ten minutes. Its own `nx run @convesoft/nx-rust-source:local-registry` waited in `ep_poll` and started no verdaccio: it neither moved to another port, as Nx's verdaccio executor does when another checkout holds 4873, nor failed.
4. After the orphaned processes were stopped, a new run passed.

- [x] Stop the registry when the global setup fails after starting it, for example by stopping it in a `try`/`catch` around the release calls and rethrowing
- [x] Find out why the second run waits rather than failing or taking another port, and make it fail with a clear message if it still cannot start a registry
- [x] Show that a run whose global setup throws after the registry started leaves no registry process behind, and that the next run passes

## Summary of Changes

Why the second run waited: Nx 24 runs a continuous task once per checkout. It records running tasks in the checkout's own database (`.nx/workspace-data`, not the one checkouts share), and `nx run` of a continuous task that a live Nx process of the same checkout already runs prints `Waiting for <task> in another nx process` and waits for that process to end without running the executor. So the `@nx/js:verdaccio` executor, which would take the next free port, never ran, and `startLocalRegistry` from `@nx/js`, which waits for `http://localhost:` on stdout with no time limit, waited as long as the orphan lived. A registry of another checkout does not cause this: the executor takes the next free port.

- `tools/scripts/local-registry.ts` (new) replaces the `@nx/js` helper. It runs the same `nx run … --location none --clear true --storage …` and points npm and pnpm at the registry as the helper did. It stops its `nx run` and fails with a message that names the cause when `nx run` waits for another process, exits before the registry started, or prints no address within two minutes. Its stop function waits until `nx run` has exited, for at most 30 seconds.
- `tools/scripts/start-local-registry.ts` stops the registry and rethrows when `releaseVersion` or `releasePublish` throws. The global teardown awaits the stop.

Checks run, with a private `NX_CACHE_DIRECTORY`:

- Before the change, a run whose setup threw after the registry started (temporary throw behind an environment variable, since removed) left `nx run …:local-registry`, its executor and verdaccio running on 4873, reparented to the user's init. The next run printed `Waiting for @convesoft/nx-rust-source:local-registry in another nx process` and was still waiting when stopped after two minutes.
- With the change and that orphan still running, the next run failed after 2 seconds with the new message, left no process of its own and did not touch the orphan.
- With the change, a run whose setup threw after the registry started left no registry process and no token in `~/.npmrc`, and the next `pnpm nx e2e nx-rust-e2e` passed (10 tests).
- With 4873 held by a registry started as if from another checkout (its own `NX_WORKSPACE_DATA_DIRECTORY`), a run took 4874 and passed.
- `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e --skip-nx-cache`, `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` (valid, evaluation complete) and `zban check` pass.

Found on the way:

- Two registries started at the same moment in different checkouts can both take 4873, because verdaccio logs its address before `listen` succeeds; one run then uses the other's registry. This predates the change and is filed as nxr-3h5eg2.
- The `FOREIGN KEY constraint failed` error from the daemon's `RECORD_TASK_RUNS` comes from an Nx client whose `NX_CACHE_DIRECTORY` setting differs from the one the checkout's daemon started with. With the variable set, Nx keeps its task database in the checkout's `.nx/workspace-data`, without it in `~/.nx/<id>/databases`, and each process decides once, when it starts. The client records the task's details in its database and the daemon records the run in the other one, which lacks them. Shown in a scratch workspace in both directions: a task whose hash neither database had seen ran, and `nx run` then exited 1 with that error. Using the same `NX_CACHE_DIRECTORY` for every Nx command of a checkout, or `NX_DAEMON=false`, avoids it. Not worked around here.
- nxr-r1b5wf is not settled: a passing run still logs `Failed to start verdaccio: undefined` when the teardown stops `nx run` by signal, now from `stopProcess` in `tools/scripts/local-registry.ts`. The `local registry exit 130` line it quotes came from the `@nx/js` helper and no longer appears.
