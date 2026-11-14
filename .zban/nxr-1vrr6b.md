---
title: Decide whether fixture commands should see Nx's sandbox variables
status: todo
type: task
priority: low
discovered_from: nxr-taaks5
created_at: 2026-11-13T22:56:12Z
---

Goal: a test sees the same Nx behaviour in a sandboxed agent session as elsewhere, or fails there for a reason it names.

Nx 24.0.6 has a second detection besides `isAiAgent()`: `isSandbox()` (`nx/dist/src/utils/is-sandbox.js`) reads `SANDBOX_RUNTIME`, `GEMINI_SANDBOX`, `CODEX_SANDBOX`, `CODEX_SANDBOX_NETWORK_DISABLED` (Codex on Linux) and `CURSOR_SANDBOX`. `testEnvironment` in `nx-rust/test/harness/environment.ts` passes them on. With one set, Nx changes behaviour only after something fails:

- When a plugin worker cannot start, Nx loads the plugins in its own process and warns, instead of failing graph creation (`project-graph/plugins/get-plugins.js`).
- When the daemon fails with an internal error, Nx prints a sandbox hint and turns the daemon off for that command only, instead of until `nx reset` (`project-graph/project-graph.js`), and other daemon and socket errors add the hint (`daemon/client/client.js`, `daemon/tmp-dir.js`, `plugins/isolation/plugin-worker.js`).

Unlike the agent variables, these describe a real restriction of the session, so leaving them out could turn a degraded run into a failing one in a sandbox that refuses sockets.

- [ ] Find out whether the unit or end-to-end suite runs in a Codex or Gemini sandbox at all, and whether its plugin workers and daemon start there
- [ ] Either leave the variables out of `testEnvironment` like the agent variables, or say in its comment why they stay

Done when: `testEnvironment`'s comment says how it treats the sandbox variables and why, and `pnpm nx run-many -t build lint test` passes.
