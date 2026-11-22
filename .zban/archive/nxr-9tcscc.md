---
title: Run zban check in CI from the @convesoft/zban npm package
status: done
type: task
tags:
  - infra
created_at: 2026-11-22T16:12:25Z
closed_at: 2026-11-22T16:24:22Z
---

The `check` job in `.github/workflows/ci.yml` installs zban 0.1.0 by downloading the GitHub release archive and checking a SHA-256 that is kept by hand, then runs `zban check`. zban is now on npm: `@convesoft/zban@1.0.0-rc.1` under the `next` dist-tag, with the binary in per-platform optional dependencies and no install script.

The maintainer decided on 22 November 2026: add it as a development dependency, pinned to the exact version, and run it through pnpm in CI. How agents and developers run zban locally is not decided yet, so `AGENTS.md` keeps what it says about the `zban` on `PATH` and the MCP server.

- [x] Add `@convesoft/zban` at exactly `1.0.0-rc.1` to the root `devDependencies`, with the lockfile
- [x] In `.github/workflows/ci.yml`, replace the "Install zban" step and `zban check` by `pnpm zban check` after `pnpm install --frozen-lockfile`
- [x] Show that `pnpm install --frozen-lockfile` works from a clean `node_modules`, that `pnpm zban --version` prints 1.0.0-rc.1 and that `pnpm zban check` passes

Done when: the pull request's `Build, lint and format` job runs `pnpm zban check` green, and `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` and `zban check` pass.

## Summary of Changes

Added `@convesoft/zban` at exactly `1.0.0-rc.1` to the root `devDependencies` with the lockfile, and replaced the "Install zban" step and `zban check` in the `Build, lint and format` job by `pnpm zban check`. pnpm's minimum release age would hold back the release candidate, so `pnpm add` wrote `minimumReleaseAgeExclude` entries to `pnpm-workspace.yaml` for `@convesoft/zban@1.0.0-rc.1` and its four platform packages at that exact version only; no other setting changed and no build approval was needed.

Checks run: `pnpm install --frozen-lockfile` from a removed `node_modules`, `pnpm zban --version` (zban 1.0.0-rc.1), `pnpm zban check`, `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` (valid) and `zban check`. The `pnpm zban check` step in the pull request's `Build, lint and format` job is covered by CI on the pull request.
