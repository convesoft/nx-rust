---
title: Make the shared test registry safe against a request on a connection that its reset closed
status: in-progress
type: bug
parent: nxr-e2z8sz
discovered_from: nxr-11vr5k
created_at: 2026-11-21T10:30:44Z
---

Goal: a test that talks to the shared sparse registry right after its reset never fails with `fetch failed` / `read ECONNRESET`, also on a loaded machine.

Context: on 21 November 2026, in an uncached run of `pnpm nx run-many -t build lint test` at c2ad5a3 (the branch of nxr-qkxcmm, which changes none of these files) while another agent's test suite ran on the same machine, `nx-rust/test/sparse-registry.spec.ts` failed once in "a registry that the tests of a test file share › starts each test with an empty registry on the same server: no index entry, upload, waiting upload, timer, log line, delay or Cargo home cache of the test before" with `TypeError: fetch failed`, cause `read ECONNRESET`. The same suite passed on the rerun (2079 passed). The log is at `~/.local/state/zban-orchestrator/nx-rust/gate4-nxr-qkxcmm.log`.

The shared registry and its reset came with nxr-11vr5k. The reset in `nx-rust/test/harness/registry-server.mts` calls `server.closeAllConnections()`. A lead, not yet shown: the test process's `fetch` keeps connections alive, so a request sent just after the reset can go out on a connection that the server has closed but the client has not yet seen closed. The spec's own requests and the harness's (`nx-rust/test/harness/sparse-registry.ts`) are the candidates; cargo's own requests come from new processes.

- [ ] Find the cause, with a reproduction that fails often enough to show it (for example the failing test repeated under load, or a delay placed where the lead points), or say what else it is
- [ ] Fix it in the harness, so that every test file that shares a registry is covered, without weakening what the reset guarantees (`nx-rust/test/README.md`) and without retries that could hide a real failure of the registry
- [ ] Show that the reproduction passes with the fix

Done when: the reproduction fails without the fix and passes with it, the release and lockfile specs that share a registry pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
