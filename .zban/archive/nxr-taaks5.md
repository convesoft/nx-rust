---
title: Keep Nx's AI-agent detection out of the commands that tests run in fixtures
status: done
type: task
priority: low
discovered_from: nxr-m60y0c
created_at: 2026-11-13T19:05:26Z
closed_at: 2026-11-13T22:56:25Z
---

Goal: a test sees the same Nx behaviour on a developer's machine, in an agent's session and in CI.

`testEnvironment` in `nx-rust/test/harness/environment.ts` passes the test process's environment to the `nx` commands it runs in fixtures, apart from `NX_` variables and a few cargo ones. Nx 24.0.6 changes its behaviour when `isAiAgent()` (native code) detects an AI agent from that environment: the `nx show` command group turns `--json` on when the flag is not given (`command-line/show/command-object.js`). A test in `nx-rust/test/redirections.spec.ts` that read `nx show projects --affected` without `--json` passed in a Claude Code session, where `CLAUDECODE` and `AI_AGENT` are set, and failed in CI, where Nx printed plain names (pull request #42, fixed there by passing `--json`). Other defaults that Nx ties to the same detection would make tests differ the same way.

- [x] Find which variables `isAiAgent()` reads in the installed Nx, or whether Nx has a setting that turns the detection off
- [x] Leave them out of `testEnvironment`, or set that setting there, and say why in its comment
- [x] Check that `nx show projects` without `--json` prints plain names in a fixture when the tests run inside an agent's session

Done when: `pnpm nx run-many -t build lint` and `pnpm nx test nx-rust --maxWorkers=6` and `pnpm nx format:check --all` pass, run from an agent's session.

## Summary of Changes

In the installed Nx 24.0.6, the native `isAiAgent()` reads `CLAUDECODE`, `CLAUDE_CODE`, `CODEX_THREAD_ID`, `SUPERSET_AGENT_ID` (value `codex`), `GEMINI_CLI`, `REPL_ID`, `VSCODE_AGENT`, `OPENCODE` and `COPILOT_CLI`, and Cursor's `CURSOR_TRACE_ID` and `COMPOSER_NO_INTERACTION` only together with its `PAGER`. It does not read `AI_AGENT`, and Nx has no setting that turns the detection off. This was checked by calling the native binding with each variable. An agent makes `nx show` print JSON and makes `summary` the default output style of `nx run`. Under `CI`, Nx turns the daemon off, skips sync generators before tasks, skips the daemon's start-up questions, warns about unknown cache artifacts and changes its performance report. Under `GITHUB_ACTIONS`, it wraps task output in log groups and appends the performance report to `$GITHUB_STEP_SUMMARY` for every fixture command.

- `testEnvironment` (`nx-rust/test/harness/environment.ts`) leaves out the agent variables (exported as `agentVariables`, with `AI_AGENT`) and `GITHUB_ACTIONS`, and sets `CI=false`, which Nx, pnpm and npm all honour. Its comment says why. `runNx` no longer needs `NX_SKIP_LOG_GROUPING`, and the daemon test in `fixture-workspace.spec.ts` no longer sets `CI=false` itself. The test README describes the new behaviour.
- New tests in `nx-rust/test/fixture-workspace.spec.ts`:
  - With the test process's environment either free of agent and CI variables, or holding every agent variable plus `CI=true`, `GITHUB_ACTIONS=true` and `GITHUB_STEP_SUMMARY`, the fixture gives the same result for `nx show projects` (plain names) and for a task's run in the default and the static style (`> nx run hello:greet`, the task's output). Nothing is written to the summary page.
  - A test that passes those variables itself gets JSON, no task output, a `::group::` line and a summary page.
  - With the filtering removed from `testEnvironment`, the first test fails.

Checks run, from a Claude Code session (`CLAUDECODE` and `AI_AGENT` set):

- `pnpm nx run-many -t build lint test --skip-nx-cache`: passed, 30 suites, 895 tests.
- `env -u CLAUDECODE -u CLAUDE_CODE -u AI_AGENT -u CODEX_THREAD_ID CI=true GITHUB_ACTIONS=true pnpm nx run-many -t build lint test --skip-nx-cache`: passed, 30 suites, 895 tests.
- `pnpm nx e2e nx-rust-e2e --skip-nx-cache`: passed, 30 tests.
- `pnpm nx format:check --all` and `zban check`: passed.

The unit tests ran with the repository's cap of 3 Jest workers rather than the `--maxWorkers=6` named under Done when, because this machine has too little memory for 6. The worker count does not affect what the check shows.

Found on the way: nxr-1vrr6b, about Nx's `isSandbox()` variables, which `testEnvironment` still passes on.
