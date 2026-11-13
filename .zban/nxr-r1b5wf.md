---
title: "A passing end-to-end run logs \"Failed to start verdaccio: undefined\" when the registry stops"
status: todo
type: bug
priority: low
tags:
  - tests
discovered_from: nxr-s46dwp
created_at: 2026-11-13T14:38:31Z
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

- [ ] Find out whether the message can be avoided from this repository (for example by how the teardown stops the registry) or only upstream in Nx, and record which
- [ ] If it can be avoided here, make a passing run log no registry error; otherwise close this issue with the finding and, if the maintainer agrees, a link to an upstream report
