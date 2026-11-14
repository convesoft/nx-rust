---
title: The Nx daemon of each checkout of this repository installs nx@latest into ~/.nx/tmp
status: done
type: task
discovered_from: nxr-eav6mm
created_at: 2026-11-13T20:32:15Z
closed_at: 2026-11-14T10:14:15Z
---

Goal: running `pnpm nx` in a checkout of this repository, as developers and agents do in each worktree, does not leave `nx@latest` installations in `~/.nx/tmp`, or the maintainer knows why it has to.

Found while working on nxr-eav6mm on 13 November 2026, with Nx 24.0.6 on Linux, outside CI.

- nxr-eav6mm keeps the daemons of the test fixtures from installing `nx@latest` (`NX_USE_LOCAL=true` in `testEnvironment`). The daemon of the repository itself is another one: the first `pnpm nx` command in a checkout starts it, and outside CI it installs `nx@latest` with pnpm into `~/.nx/tmp/tmp-<pid>-<random>` (about 73 MB) to answer whether to offer Nx Console and whether the AI agent configuration is outdated (`node_modules/nx/dist/src/daemon/server/server.js`, `latest-nx.js`). In this worktree, `pnpm nx format:write` and `pnpm nx run-many -t build lint test` started such a daemon and left `tmp-<daemon pid>-…` with `{"devDependencies":{"nx":"24.0.6"}}` for as long as the daemon runs.
- The daemon removes the folder when it stops, but not an install still running at that moment, and not when it is killed. With a worktree per agent, every checkout has its own daemon and its own copy.
- `NX_USE_LOCAL=true` in the environment of the `nx` command that starts the daemon avoids it (also `CI`, which changes much more). Nx 24.0.6 loads the root `.env` files only in its task runner (`loadRootEnvFiles`, called from `tasks-runner/init-tasks-runner.js`), not before it starts the daemon, so a `.env` in the repository does not reach the daemon.

- [x] Decide with the maintainer whether the repository should do anything (for example a documented environment variable for contributors and agents, or nothing because it is Nx's behaviour on every machine)
- [x] If so, do it and show with the daemon log of a checkout (`.nx/workspace-data/d/daemon.log`) that it no longer pulls `nx@latest`

Done when: the decision is recorded here, and, if something changed, the check above passes.

## Summary of Changes

Decision: on 13 November 2026 the maintainer agreed to set `NX_USE_LOCAL=true` in the configuration of the agents on the maintainer's machine, and left the rest to the control plane. The control plane decided that the repository changes nothing in code or configuration. This is Nx's behaviour for every workspace outside CI, and a `.env` file does not reach the daemon. The Development section of the root `README.md` now tells contributors three things. Outside CI, the daemon that a checkout's first `nx` command starts installs `nx@latest` into `~/.nx/tmp`, about 73 MB for each checkout, and removes it when it stops. `NX_USE_LOCAL=true` in the environment of the `nx` commands avoids it. A `.env` file does not reach the daemon.

Shown with the daemon log of this checkout (`.nx/workspace-data/d/daemon.log`), Nx 24.0.6, outside CI. The daemon was started with `pnpm nx daemon --start` and stopped after each case.

- With `NX_USE_LOCAL=true`, 4 ms after `Started listening`, and no new folder in `~/.nx/tmp`:
  `[NX v24.0.6 Daemon Server] - 2026-11-14T10:06:42.353Z - [NX-CONSOLE]: Using local implementation (NX_USE_LOCAL=true or inner call)`
- Without it, no such line at the start. The line came only 1.1 s later, from the inner call into the downloaded Nx, and was followed by `Console status check completed, shouldPrompt: false`. Meanwhile `~/.nx/tmp/tmp-1780998-3FTpLdVhM594` (73 MB, `{"devDependencies":{"nx":"24.0.6"}}`) appeared, and it was gone after the daemon stopped:
  `[NX v24.0.6 Daemon Server] - 2026-11-14T10:06:24.529Z - [AI-AGENTS]: Starting agent configuration status computation` (no `Using local implementation` line follows it)

`pnpm nx format:check --all` and `zban check` pass.
