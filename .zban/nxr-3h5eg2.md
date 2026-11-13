---
title: Two end-to-end runs whose registries start at the same moment in different checkouts share one registry
status: todo
type: bug
tags:
  - tests
discovered_from: nxr-f6f9gh
created_at: 2026-11-13T15:25:35Z
---

Goal: two `pnpm nx e2e nx-rust-e2e` runs in different checkouts of this repository that start at about the same time each publish to and install from a local registry of their own.

Found while working on nxr-f6f9gh on 13 November 2026, with Nx 24.0.6 and verdaccio 6.11.1 on Linux.

The `@nx/js:verdaccio` executor takes the first free port from 4873, which `detect-port` finds by binding the port and releasing it again; verdaccio then listens on it. Verdaccio logs `http address - http://localhost:<port>/` before `listen` succeeds, and `startLocalRegistry` in `tools/scripts/local-registry.ts`, like the `@nx/js` helper it replaced, takes that line as the sign that the registry started. When two checkouts start their registries within about a second of each other, both executors can take 4873. The verdaccio that loses exits with `cannot create http server: listen EADDRINUSE`, but by then both setups have pointed npm and pnpm at `http://localhost:4873`. The losing run then publishes `@convesoft/nx-rust@0.0.0-e2e` to the other checkout's registry, so one of the two publishes is rejected or a run tests the other checkout's build. The losing run logs `The local registry stopped unexpectedly: nx run @convesoft/nx-rust-source:local-registry exited with code 1.` and carries on.

Reproduced from a single checkout by starting the registry twice at once through `startLocalRegistry`, each with its own `NX_WORKSPACE_DATA_DIRECTORY` (so that Nx tracks the two tasks apart, as it does for two checkouts) and its own storage: in 2 of 3 rounds both reported port 4873, and one `nx run` exited with code 1 about a second later.

- [ ] Make the setup confirm that its own registry listens before it publishes, and start again on another port when it lost the port
- [ ] Show that two registries started at the same moment, as in the reproduction above, end up on different ports, and that each setup uses its own
