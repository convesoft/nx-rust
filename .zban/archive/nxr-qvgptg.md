---
title: The end-to-end suite fails when a coding agent runs it
status: done
type: bug
priority: high
tags:
  - tests
discovered_from: nxr-cxkn34
created_at: 2026-11-13T07:13:22Z
closed_at: 2026-11-13T07:54:50Z
---

`pnpm nx e2e nx-rust-e2e` passes in CI and in a plain terminal, and fails when a coding agent runs it. `AGENTS.md` asks agents to run it, so every agent that changes the built plugin hits this.

Cause, found with `create-nx-workspace` 24.0.6 and pnpm 12.18.0: `create-nx-workspace` detects an agent from environment variables such as `CLAUDECODE`, `CODEX_THREAD_ID`, `OPENCODE`, `COPILOT_CLI` and `GEMINI_CLI`, and then takes another path. It clones the template `nrwl/empty-template` instead of generating the `apps` preset. Two things go wrong on that path:

1. It runs `git add README.md` and then `git commit --amend --no-edit` in the test project. The test project lies inside this repository (`nx-rust-e2e/tmp/test-project`) and is not a repository of its own, so both commands act on this repository. Today `git add` fails because `tmp` is git-ignored, which stops the run before the amend. Nothing was changed, but only by that accident.
2. With `--skipGit` added, the next step fails: the template pins `nx@24.0.0` and approves no build scripts, so `pnpm add` stops with `ERR_PNPM_IGNORED_BUILDS` for `nx` and `@swc/core`.

To reproduce the passing case from an agent: `env -u CLAUDECODE -u CLAUDE_CODE CI=true pnpm nx e2e nx-rust-e2e --skip-nx-cache`.

Also found: the test calls `create-nx-workspace@latest`, so a new Nx major changes what the suite tests without any change here. `@nx/devkit` exports `NX_VERSION`, the Nx version of this workspace.

- [x] The suite gives the same result whether or not agent environment variables are set
- [x] `create-nx-workspace` cannot run a git command against this repository (`--skipGit`, or a test project outside the repository)
- [x] The Nx version of the test project is pinned instead of `latest`
- [x] If the fix builds the test project by hand instead of calling `create-nx-workspace`, agree it with the harness work in nxr-qak38j

Done when: `pnpm nx e2e nx-rust-e2e --skip-nx-cache` passes with `CLAUDECODE=1` set and with it unset, and `git status` and `git log -1` of this repository are unchanged after both runs.

## Summary of Changes

- `createTestProject` in `nx-rust-e2e/src/nx-rust.spec.ts` no longer calls `create-nx-workspace`. It writes an empty Nx workspace by hand (`package.json` with `nx` at `NX_VERSION` from `@nx/devkit`, an empty `nx.json`, and a `pnpm-workspace.yaml` that allows the build script of `nx`) and runs `pnpm install --no-frozen-lockfile`. The plugin is then added as before.
- The workspace is the same for every caller, nothing in the suite runs git, and the Nx version is the one this repository uses instead of `latest`.
- Rejected: keeping `create-nx-workspace` with `--skipGit` and removing the agent variables from its environment. The list of variables belongs to `create-nx-workspace` and can grow with any release, and on the agent path the install still failed with `ERR_PNPM_IGNORED_BUILDS`.
- Rejected: a test project in the system's temporary folder. On a machine where that folder is another file system, here a tmpfs, pnpm cannot link from its store, so every run copies Nx into memory.
- The test project stays in `nx-rust-e2e/tmp/test-project`. Nx finds projects there although the folder is git-ignored by this repository (tried with a hand-written workspace and `nx show projects`).
- nxr-qak38j, the harness work, now points at the helper. Nobody had started it, so there was no one to agree with; the note there records the choice.

Checks run: `pnpm nx e2e nx-rust-e2e --skip-nx-cache` with `CLAUDECODE=1` (passes) and with the agent variables unset and `CI=true` (passes); `git status` showed only the edited test file and `git log -1` was unchanged after both runs; `pnpm nx run-many -t build lint test`; `pnpm nx format:check --all`; `zban check`. No knowledge changed. CI on this issue's pull request runs the suite once more in its own environment.
