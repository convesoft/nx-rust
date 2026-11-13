---
title: The daemon tests make Nx download nx@latest into ~/.nx/tmp
status: done
type: bug
tags:
  - tests
discovered_from: nxr-er7ve6
created_at: 2026-11-13T19:49:46Z
closed_at: 2026-11-13T20:33:29Z
---

Goal: the unit tests that turn the Nx daemon on make Nx download nothing and leave nothing in `~/.nx/tmp`.

Found while working on nxr-er7ve6 on 13 November 2026, with Nx 24.0.6 on Linux, outside CI.

- `nx run` asks the daemon for the AI agent configuration status unless `isCI()` (`printConfigureAiAgentsDisclaimer` in `node_modules/nx/dist/src/tasks-runner/run-command.js`). The daemon then installs `nx@latest` with the workspace's package manager into `~/.nx/tmp/tmp-<pid>-<random>`, about 73 MB (`node_modules/nx/dist/src/daemon/server/latest-nx.js`). It removes the folder when it shuts down, but only once the install has finished; an install still running at `nx daemon --stop` stays until Nx removes it a day later.
- With `NX_RUST_KEEP_FIXTURES=1`, the daemon logs of the fixtures that `unknown-options.spec.ts`, `compatibility.spec.ts` and `configuration.spec.ts` run with `NX_DAEMON=true` show `[LATEST-NX]: Pulling latest Nx...` and `Successfully pulled latest Nx to /home/<user>/.nx/tmp/tmp-<pid>-<random>`, also for the daemon of a fake Nx 25.0.0. One of those runs left a folder behind. The machine had 189 such folders (about 13 GB, not all from the tests).
- So the unit tests also reach the npm registry.

- [x] Find how the harness can keep the daemon from installing `nx@latest` (an environment variable or setting that the installed Nx honours), without changing what the daemon tests check
- [x] Show with a daemon log that a fixture's daemon no longer pulls Nx, and that a run of the three specs leaves nothing in `~/.nx/tmp`

Done when: the check above is recorded here, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Summary of Changes

- `testEnvironment` (`nx-rust/test/harness/environment.ts`) sets `NX_USE_LOCAL=true` for every `nx` command of a fixture and of the end-to-end project. In Nx 24.0.6 a daemon outside CI calls `getLatestNxTmpPath` at start (`daemon/server/server.js`) for the Nx Console status (`nx-console-operations.js`) and the AI agent configuration status (`handle-configure-ai-agents.js`), the only two callers; both use the installed Nx when `NX_USE_LOCAL` is `true`. Elsewhere the variable only makes `nx migrate`, `nx init` and `nx configure-ai-agents` run the installed Nx, which no test runs. `CI` was not used: it would also stop the download, but changes whether `nx run` applies sync generators, the cache-directory warning, spinners, and pnpm's lockfile default in the end-to-end project. `nx-rust/test/README.md` says why.
- New test in `nx-rust/test/fixture-workspace.spec.ts`: a fixture's daemon, started with `CI=false` so that it asks in CI too, answers both questions with the installed Nx (`[AI-AGENTS]: Using local implementation`) and logs no `[LATEST-NX]`.
- The download is Nx's own: the plugin starts no `nx` command and no daemon. The daemon of the repository itself pulls `nx@latest` in the same way; filed as nxr-1x5x66.

Checks:

- Before the change: with `NX_RUST_KEEP_FIXTURES=1`, both daemon logs of the `with the daemon` tests in `unknown-options.spec.ts` showed `[LATEST-NX]: Pulling latest Nx...` and `Successfully pulled latest Nx to ~/.nx/tmp/tmp-<pid>-…`.
- After the change: `unknown-options`, `compatibility`, `configuration`, `run-arguments` and `cargo-directories` specs with `NX_RUST_KEEP_FIXTURES=1`: 167 tests passed; 9 fixtures had a daemon log (10 daemon starts, one of them the fake Nx 25.0.0), with 0 `[LATEST-NX]` lines and `Using local implementation` for both questions in each; no new folder in `~/.nx/tmp` during the run. The kept fixtures were removed afterwards.
- `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e` (27 tests, nothing new in `~/.nx/tmp`) and `zban check` passed.
