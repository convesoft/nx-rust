---
title: The end-to-end suite fails when a coding agent runs it
status: todo
type: bug
priority: high
tags:
  - tests
discovered_from: nxr-cxkn34
created_at: 2026-11-13T07:13:22Z
---

`pnpm exec nx e2e nx-rust-e2e` passes in CI and in a plain terminal, and fails when a coding agent runs it. `AGENTS.md` asks agents to run it, so every agent that changes the built plugin hits this.

Cause, found with `create-nx-workspace` 24.0.6 and pnpm 12.18.0: `create-nx-workspace` detects an agent from environment variables such as `CLAUDECODE`, `CODEX_THREAD_ID`, `OPENCODE`, `COPILOT_CLI` and `GEMINI_CLI`, and then takes another path. It clones the template `nrwl/empty-template` instead of generating the `apps` preset. Two things go wrong on that path:

1. It runs `git add README.md` and then `git commit --amend --no-edit` in the test project. The test project lies inside this repository (`nx-rust-e2e/tmp/test-project`) and is not a repository of its own, so both commands act on this repository. Today `git add` fails because `tmp` is git-ignored, which stops the run before the amend. Nothing was changed, but only by that accident.
2. With `--skipGit` added, the next step fails: the template pins `nx@24.0.0` and approves no build scripts, so `pnpm add` stops with `ERR_PNPM_IGNORED_BUILDS` for `nx` and `@swc/core`.

To reproduce the passing case from an agent: `env -u CLAUDECODE -u CLAUDE_CODE CI=true pnpm exec nx e2e nx-rust-e2e --skip-nx-cache`.

Also found: the test calls `create-nx-workspace@latest`, so a new Nx major changes what the suite tests without any change here. `@nx/devkit` exports `NX_VERSION`, the Nx version of this workspace.

- [ ] The suite gives the same result whether or not agent environment variables are set
- [ ] `create-nx-workspace` cannot run a git command against this repository (`--skipGit`, or a test project outside the repository)
- [ ] The Nx version of the test project is pinned instead of `latest`
- [ ] If the fix builds the test project by hand instead of calling `create-nx-workspace`, agree it with the harness work in nxr-qak38j

Done when: `pnpm exec nx e2e nx-rust-e2e --skip-nx-cache` passes with `CLAUDECODE=1` set and with it unset, and `git status` and `git log -1` of this repository are unchanged after both runs.
