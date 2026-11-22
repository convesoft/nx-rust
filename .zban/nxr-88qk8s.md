---
title: Check the lockfile digests once per group after cargo, not once per task
status: todo
type: task
priority: deferred
tags:
  - deferred
  - backlog
discovered_from: nxr-h52ghk
created_at: 2026-11-22T16:50:53Z
---

Cites: `DES-LOCKFILE-HASHING`, `DES-BATCH`.

Goal: the lockfile check after a group's cargo call costs one parse of `Cargo.lock` and one digest per member, whatever the number of tasks. The result of the check does not change.

Context: finding 5 of the architecture audit after 1.0.0-rc.2 (22 November 2026, at 66964f3). Wave: behavior. After a group's cargo call, `nx-rust/src/executors/group-run.ts` calls `checksAfterCargo` and so `checkDigests` (`executors/digests.ts`) for every task that passed. Under `workspace-build` and `cargo`, each task's check lists every member of the workspace, so N tasks parse `Cargo.lock` N times and compute N times N member digests, and `reachedEntries` (`cargo/lockfile.ts`) builds its index by name over the whole lockfile again for each of them. For a workspace of 50 to 100 crates, one `cargo check` means 50 to 100 parses and thousands of walks.

- [ ] Measure the check for a workspace of about 50 members before and after
- [ ] Build the index by name once when the lockfile is parsed
- [ ] Compute the check once per distinct lockfile, folder and member list of a group, and give each task its result

Done when: the measurement shows the cost no longer grows with the square of the member count, the existing lockfile tests pass unchanged, and `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e` and `pnpm nx format:check --all` pass.
