---
title: The daemon tests make Nx download nx@latest into ~/.nx/tmp
status: todo
type: bug
tags:
  - tests
discovered_from: nxr-er7ve6
created_at: 2026-11-13T19:49:46Z
---

Goal: the unit tests that turn the Nx daemon on make Nx download nothing and leave nothing in `~/.nx/tmp`.

Found while working on nxr-er7ve6 on 13 November 2026, with Nx 24.0.6 on Linux, outside CI.

- `nx run` asks the daemon for the AI agent configuration status unless `isCI()` (`printConfigureAiAgentsDisclaimer` in `node_modules/nx/dist/src/tasks-runner/run-command.js`). The daemon then installs `nx@latest` with the workspace's package manager into `~/.nx/tmp/tmp-<pid>-<random>`, about 73 MB (`node_modules/nx/dist/src/daemon/server/latest-nx.js`). It removes the folder when it shuts down, but only once the install has finished; an install still running at `nx daemon --stop` stays until Nx removes it a day later.
- With `NX_RUST_KEEP_FIXTURES=1`, the daemon logs of the fixtures that `unknown-options.spec.ts`, `compatibility.spec.ts` and `configuration.spec.ts` run with `NX_DAEMON=true` show `[LATEST-NX]: Pulling latest Nx...` and `Successfully pulled latest Nx to /home/<user>/.nx/tmp/tmp-<pid>-<random>`, also for the daemon of a fake Nx 25.0.0. One of those runs left a folder behind. The machine had 189 such folders (about 13 GB, not all from the tests).
- So the unit tests also reach the npm registry.

- [ ] Find how the harness can keep the daemon from installing `nx@latest` (an environment variable or setting that the installed Nx honours), without changing what the daemon tests check
- [ ] Show with a daemon log that a fixture's daemon no longer pulls Nx, and that a run of the three specs leaves nothing in `~/.nx/tmp`

Done when: the check above is recorded here, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
