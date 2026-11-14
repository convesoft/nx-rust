---
title: "A passing end-to-end run logs \"Failed to start verdaccio: undefined\" when the registry stops"
status: done
type: bug
priority: low
tags:
  - tests
discovered_from: nxr-s46dwp
created_at: 2026-11-13T14:38:31Z
closed_at: 2026-11-14T10:14:08Z
---

Goal: a passing end-to-end run does not log an error about the local registry, so that the log of a real registry failure stands out.

Found while working on nxr-s46dwp on 13 November 2026, with Nx 24.0.6 on Linux. Every `pnpm nx e2e nx-rust-e2e` run, passing ones included and before that change as well, ends with:

```
Failed to start verdaccio: undefined

 NX   1 task: 0 succeeded, 1 stopped
Stopped before finishing:
- @convesoft/nx-rust-source:local-registry
local registry exit 130
```

The line comes from the `@nx/js:verdaccio` executor (`dist/src/executors/verdaccio/verdaccio.impl.js`): its promise around the verdaccio child process rejects when the child exits or disconnects with anything but code 0, and the executor logs any rejection as a failure to start. The global teardown (`tools/scripts/stop-local-registry.ts`) stops the registry by signal, so the expected stop is logged as an error. Related to, but separate from, nxr-f6f9gh (a registry left running after a failed setup).

- [x] Find out whether the message can be avoided from this repository (for example by how the teardown stops the registry) or only upstream in Nx, and record which
- [x] If it can be avoided here, make a passing run log no registry error; otherwise close this issue with the finding and, if the maintainer agrees, a link to an upstream report

## Summary of Changes

Finding: the line comes from the `@nx/js:verdaccio` executor of `@nx/js` 24.0.6, `node_modules/@nx/js/dist/src/executors/verdaccio/verdaccio.impl.js`.

- `startVerdaccio` forks verdaccio with an IPC channel and rejects its promise on the child's `disconnect` event (lines 94–96). The event has no argument, hence `undefined`. It also rejects on an exit with any code other than 0 (lines 97–106).
- `verdaccioExecutor` logs every rejection as `Failed to start verdaccio: ` plus the reason (line 58) and returns `success: false`.
- The IPC channel closes whenever verdaccio exits, and in every stop observed here `disconnect` came before `exit`. So every stop of the registry logs the line, whatever the signal or exit code.
- Nx stops a continuous task by signalling its whole process tree (`killProcessTreeGraceful` in `nx/dist/src/tasks-runner/running-tasks/node-child-process.js`). How the teardown stops `nx run` therefore cannot prevent the line while the target uses this executor. Only Nx can change the executor; no upstream report was written, as decided for now.

What this repository does instead: `tools/scripts/local-registry.ts` shows the stderr of `nx run` only until the setup asks it to stop. What `nx run` prints after that is kept (the executor's line and Nx's `1 task: 0 succeeded, 1 stopped` summary), and it is added to the warning if `nx run` does not stop within 30 seconds. A registry that stops without being asked still shows its stderr live, next to the existing "stopped unexpectedly" message. This also drops the line for a registry the setup gives up after another server took its port (nxr-3h5eg2).

Checks:

- Before: starting and stopping the registry through `startLocalRegistry`, from a short script run with `@swc-node/register`, printed `Failed to start verdaccio: undefined` and Nx's stop summary. The `pnpm nx e2e nx-rust-e2e` runs before the change logged both after `Tests: 30 passed`.
- After: the same script printed only `Local registry started on http://localhost:4873`. The four end-to-end runs that ran the suite after the change logged neither line, one of them on cargo 1.91.0 and the last on the tree merged with `origin/main` cd8c0fd.
- Not exercised: the 30-second timeout path that shows the kept output.
- `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all` and `zban check` pass.
