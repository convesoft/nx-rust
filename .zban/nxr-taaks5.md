---
title: Keep Nx's AI-agent detection out of the commands that tests run in fixtures
status: todo
type: task
priority: low
discovered_from: nxr-m60y0c
created_at: 2026-11-13T19:05:26Z
---

Goal: a test sees the same Nx behaviour on a developer's machine, in an agent's session and in CI.

`testEnvironment` in `nx-rust/test/harness/environment.ts` passes the test process's environment to the `nx` commands it runs in fixtures, apart from `NX_` variables and a few cargo ones. Nx 24.0.6 changes its behaviour when `isAiAgent()` (native code) detects an AI agent from that environment: the `nx show` command group turns `--json` on when the flag is not given (`command-line/show/command-object.js`). A test in `nx-rust/test/redirections.spec.ts` that read `nx show projects --affected` without `--json` passed in a Claude Code session, where `CLAUDECODE` and `AI_AGENT` are set, and failed in CI, where Nx printed plain names (pull request #42, fixed there by passing `--json`). Other defaults that Nx ties to the same detection would make tests differ the same way.

- [ ] Find which variables `isAiAgent()` reads in the installed Nx, or whether Nx has a setting that turns the detection off
- [ ] Leave them out of `testEnvironment`, or set that setting there, and say why in its comment
- [ ] Check that `nx show projects` without `--json` prints plain names in a fixture when the tests run inside an agent's session

Done when: `pnpm nx run-many -t build lint` and `pnpm nx test nx-rust --maxWorkers=6` and `pnpm nx format:check --all` pass, run from an agent's session.
