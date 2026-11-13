---
title: The Nx daemon of each checkout of this repository installs nx@latest into ~/.nx/tmp
status: todo
type: task
discovered_from: nxr-eav6mm
created_at: 2026-11-13T20:32:15Z
---

Goal: running `pnpm nx` in a checkout of this repository, as developers and agents do in each worktree, does not leave `nx@latest` installations in `~/.nx/tmp`, or the maintainer knows why it has to.

Found while working on nxr-eav6mm on 13 November 2026, with Nx 24.0.6 on Linux, outside CI.

- nxr-eav6mm keeps the daemons of the test fixtures from installing `nx@latest` (`NX_USE_LOCAL=true` in `testEnvironment`). The daemon of the repository itself is another one: the first `pnpm nx` command in a checkout starts it, and outside CI it installs `nx@latest` with pnpm into `~/.nx/tmp/tmp-<pid>-<random>` (about 73 MB) to answer whether to offer Nx Console and whether the AI agent configuration is outdated (`node_modules/nx/dist/src/daemon/server/server.js`, `latest-nx.js`). In this worktree, `pnpm nx format:write` and `pnpm nx run-many -t build lint test` started such a daemon and left `tmp-<daemon pid>-…` with `{"devDependencies":{"nx":"24.0.6"}}` for as long as the daemon runs.
- The daemon removes the folder when it stops, but not an install still running at that moment, and not when it is killed. With a worktree per agent, every checkout has its own daemon and its own copy.
- `NX_USE_LOCAL=true` in the environment of the `nx` command that starts the daemon avoids it (also `CI`, which changes much more). Nx 24.0.6 loads the root `.env` files only in its task runner (`loadRootEnvFiles`, called from `tasks-runner/init-tasks-runner.js`), not before it starts the daemon, so a `.env` in the repository does not reach the daemon.

- [ ] Decide with the maintainer whether the repository should do anything (for example a documented environment variable for contributors and agents, or nothing because it is Nx's behaviour on every machine)
- [ ] If so, do it and show with the daemon log of a checkout (`.nx/workspace-data/d/daemon.log`) that it no longer pulls `nx@latest`

Done when: the decision is recorded here, and, if something changed, the check above passes.
