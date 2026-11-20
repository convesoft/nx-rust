---
title: Run the real Nx in a .nx/installation layout in the automated suites
status: todo
type: task
priority: deferred
tags:
  - deferred
  - backlog
discovered_from: nxr-gtxq18
created_at: 2026-11-20T13:24:37Z
---

Goal: an automated check runs the real Nx, with its installation wrapper, graph worker and hasher, in a repository whose Nx and plugin live under `.nx/installation` (`VER-SETUP`, `REQ-COMPATIBILITY`).

Context: found by the review of nxr-gtxq18. `nx-rust/test/nx-bridge.spec.ts` checks resolution from `.nx/installation` with real Node resolution but with stand-in `nx` packages, so no committed test runs Nx itself in that layout. The reviewer ran graph creation, the init generator, cached builds, batches and an affected test run by hand in such a fixture at commit 6fe4c94, and all passed.

- [ ] Add a test (unit suite or end-to-end suite, whichever sets the layout up as Nx itself does at reasonable cost) that creates the graph and runs a cached `build` in a `.nx/installation` repository under `$TMPDIR`

Done when: the test passes, and `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e` and `pnpm nx format:check --all` pass.
