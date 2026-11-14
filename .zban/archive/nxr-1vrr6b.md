---
title: Decide whether fixture commands should see Nx's sandbox variables
status: done
type: task
priority: low
discovered_from: nxr-taaks5
created_at: 2026-11-13T22:56:12Z
closed_at: 2026-11-14T10:40:35Z
---

Goal: a test sees the same Nx behaviour in a sandboxed agent session as elsewhere, or fails there for a reason it names.

Nx 24.0.6 has a second detection besides `isAiAgent()`: `isSandbox()` (`nx/dist/src/utils/is-sandbox.js`) reads `SANDBOX_RUNTIME`, `GEMINI_SANDBOX`, `CODEX_SANDBOX`, `CODEX_SANDBOX_NETWORK_DISABLED` (Codex on Linux) and `CURSOR_SANDBOX`. `testEnvironment` in `nx-rust/test/harness/environment.ts` passes them on. With one set, Nx changes behaviour only after something fails:

- When a plugin worker cannot start, Nx loads the plugins in its own process and warns, instead of failing graph creation (`project-graph/plugins/get-plugins.js`).
- When the daemon fails with an internal error, Nx prints a sandbox hint and turns the daemon off for that command only, instead of until `nx reset` (`project-graph/project-graph.js`), and other daemon and socket errors add the hint (`daemon/client/client.js`, `daemon/tmp-dir.js`, `plugins/isolation/plugin-worker.js`).

Unlike the agent variables, these describe a real restriction of the session, so leaving them out could turn a degraded run into a failing one in a sandbox that refuses sockets.

- [x] Find out whether the unit or end-to-end suite runs in a Codex or Gemini sandbox at all, and whether its plugin workers and daemon start there
- [x] Either leave the variables out of `testEnvironment` like the agent variables, or say in its comment why they stay

Done when: `testEnvironment`'s comment says how it treats the sandbox variables and why, and `pnpm nx run-many -t build lint test` passes.

## Summary of Changes

Decision (the control plane's): the sandbox variables stay passed on to fixture commands. Unlike the agent variables they describe a real restriction of the session, and leaving them out could turn a run that Nx degrades gracefully in a sandbox into a failing one.

What was found, on 14 November 2026 with Nx 24.0.6 and Node 26.12 on Linux:

- The implementing session ran in Claude Code (`CLAUDECODE` and `AI_AGENT` set) without its sandbox: none of `SANDBOX_RUNTIME`, `GEMINI_SANDBOX`, `CODEX_SANDBOX`, `CODEX_SANDBOX_NETWORK_DISABLED` or `CURSOR_SANDBOX` was set, and `~/.claude/settings.json` enables no sandbox. Nx's own comment (`daemon/sandbox-socket-hint.js`) says Claude Code sets `SANDBOX_RUNTIME` only with `sandbox.enabled`. Nothing in this repository or its CI sets any of them, and plugin workers and the daemon started in every run. Whether Codex workers of the control plane run sandboxed was not observable from here.
- Nx reads them only in JavaScript (the native binary holds none of the names), through `isSandbox()`, and only after something failed: a plugin worker that cannot start (`get-plugins.js` falls back to loading in-process with a warning; `isolated-plugin.js` and `plugin-worker.js` add a hint), an internal daemon error (`project-graph.js` disables the daemon for that command only), daemon socket errors (`daemon/client/client.js`), the socket-directory fallback warning (`daemon/tmp-dir.js`), and a failed write of agent settings (`ai/utils.js`, used by `nx init` and `nx configure-ai-agents`). `nx init` also turns off the daemon and isolation, but only together with `isAiAgent()`, whose variables the harness leaves out, and no test runs it.
- Where nothing fails, a fixture command behaves the same: the 13 spec files that use plugin workers or the daemon passed with `SANDBOX_RUNTIME=1` set (445 tests), and their output held no sandbox hint. So the decision stands.

The comment on `testEnvironment` (`nx-rust/test/harness/environment.ts`) now says that and why the variables are passed on, and `nx-rust/test/README.md` says so in a sentence.

Checks run: `pnpm nx run-many -t build lint test` (pass, 1153 tests passed, 1 todo), `pnpm nx format:check --all` (pass), `zban check` (pass), and the 13 worker and daemon spec files with `SANDBOX_RUNTIME=1` (pass). The end-to-end suite was not run: only a comment changed in what it uses.
