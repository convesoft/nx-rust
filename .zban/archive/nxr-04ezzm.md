---
title: Make the shared test registry safe against a request on a connection that its reset closed
status: done
type: bug
parent: nxr-e2z8sz
discovered_from: nxr-11vr5k
created_at: 2026-11-21T10:30:44Z
closed_at: 2026-11-21T12:11:25Z
---

Goal: a test that talks to the shared sparse registry right after its reset never fails with `fetch failed` / `read ECONNRESET`, also on a loaded machine.

Context: on 21 November 2026, in an uncached run of `pnpm nx run-many -t build lint test` at c2ad5a3 (the branch of nxr-qkxcmm, which changes none of these files) while another agent's test suite ran on the same machine, `nx-rust/test/sparse-registry.spec.ts` failed once in "a registry that the tests of a test file share › starts each test with an empty registry on the same server: no index entry, upload, waiting upload, timer, log line, delay or Cargo home cache of the test before" with `TypeError: fetch failed`, cause `read ECONNRESET`. The same suite passed on the rerun (2079 passed). The log is at `~/.local/state/zban-orchestrator/nx-rust/gate4-nxr-qkxcmm.log`.

The shared registry and its reset came with nxr-11vr5k. The reset in `nx-rust/test/harness/registry-server.mts` calls `server.closeAllConnections()`. A lead, not yet shown: the test process's `fetch` keeps connections alive, so a request sent just after the reset can go out on a connection that the server has closed but the client has not yet seen closed. The spec's own requests and the harness's (`nx-rust/test/harness/sparse-registry.ts`) are the candidates; cargo's own requests come from new processes.

The orchestrator changed these task items and `Done when` on 21 November 2026, because the failure could not be reproduced.

- [x] Try to reproduce it. Every attempt passed: 300 and 500 rounds of a reset followed by a `fetch` GET, idle and with 48–64 busy loops on 32 cores; the same with a PUT, idle and loaded (undici repeats an idempotent GET once on a reused connection that turns out closed, never a PUT, and the failing request is the `upload` PUT); the real test 30 times under 48 busy loops; a PUT, a 5.5 s synchronous stall across the server's 5 s keep-alive timeout, then a second PUT. The lead looks unlikely: `reset` closes the sockets before the server sends `reset-done`, so the test process sees the FIN before the reply, and `flushIndex` adds another IPC round trip before the first upload. The other candidate is a pooled connection that the keep-alive timeout closes as the client reuses it after a stall. Neither is shown.
- [x] Run the full suite without the header, with the full error and its `cause` chain logged from the test's `upload` helper: 0 failures in 3 runs of `pnpm nx test nx-rust --skip-nx-cache` and 2 of `pnpm nx run-many -t build lint test --skip-nx-cache --output-style=static`, all 2079 passed. The orchestrator saw the same test fail in 2 of 4 such runs elsewhere (gate4-nxr-qkxcmm.log at c2ad5a3, gate4-nxr-yfh7zh.log at b9f6cf3), so it fails only under load from other agents' suites, and no error with its `cause` chain was caught.
- [x] Make the server in `nx-rust/test/harness/registry-server.mts` answer every request with `Connection: close` (the tunnel's 403 already did). Made without a failing reproduction because it removes connection reuse, which both candidates need, and adds no retry. One sentence in `nx-rust/test/README.md` says so.
- [x] If `fetch failed` shows up again against this registry, record the full error with its `cause` chain before anything else.

Done when: the specs that share a registry pass, the failing test passes 30 times in a row under load as in the attempt above, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Notes (21 November 2026): not reproduced

Tried, none failed:
- 300 and 500 rounds of reset then `fetch` GET, idle and with 48–64 busy loops on 32 cores.
- 300 and 500 rounds of reset then `fetch` PUT, idle and loaded. A PUT matters because undici repeats an idempotent request (GET) once when a reused connection turns out closed, but never a PUT, and the failing request is the test's `upload` PUT.
- The real test (`-t "starts each test with an empty registry"`) 30 times under 48 busy loops.
- A forced stall: a PUT, then a 5.5 s synchronous stall of the test process across the server's 5 s keep-alive timeout, then a second PUT.

Why the reset lead looks unlikely: `reset` closes the sockets (the fds close synchronously) before the server sends `reset-done`, so the test process gets the FIN before the IPC reply. In the failing test, `flushIndex` also does an IPC round trip before the first upload.

Other candidate: the client reuses a pooled connection just as the server's keep-alive timeout (5 s) closes it, after an event-loop stall under load. This was not shown either.

A likely fix for both candidates, not applied because nothing has reproduced: have `registry-server.mts` answer every request with `Connection: close`, so that no client (test `fetch`, harness or cargo) reuses a connection the server may close. This adds no retry and changes no reset guarantee.

## Summary of Changes

`nx-rust/test/harness/registry-server.mts` now answers every request with `Connection: close` (the tunnel's 403 already did). No client reuses a connection, so neither a reset nor the keep-alive timeout can close a connection that a next request goes out on. There is no retry. One sentence in `nx-rust/test/README.md` says so. The orchestrator decided this after the failure, seen in 2 of 4 full runs elsewhere, could not be reproduced here (see the task items). The "not reproduced" notes above are accurate for this checkout. If `fetch failed` shows up again against this registry, record the full error with its `cause` chain before anything else.

Checks run with the header:
- `sparse-registry`, every `release-*` spec and `lockfile-runs.spec.ts`: 319 passed.
- The failing test 30 times in a row under 48 busy loops: 0 failures.
- `pnpm nx run-many -t build lint test --skip-nx-cache`: 2079 passed.
- `pnpm nx format:check --all` and `zban check`: pass.

Spec times before → after: lockfile-runs 74.0 → 68.1 s, release-registries 26.4 → 24.4 s, release-lockfile 21.8 → 21.7 s, release-version 21.3 → 18.4 s, release-publish 17.9 → 15.6 s, sparse-registry 12.7 → 12.2 s. Nothing got slower.

## Decisions made

- The orchestrator decided to send `Connection: close` on every answer of the test registry without a failing reproduction, because it removes the connection reuse that both candidate causes need and adds no retry. The orchestrator also rewrote the task items and `Done when`.
