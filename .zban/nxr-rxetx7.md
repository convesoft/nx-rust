---
title: Run cargo metadata once for a group and carry its directories on the invocation
status: todo
type: task
priority: deferred
tags:
  - deferred
  - backlog
blocked_by:
  - nxr-2m21ya
discovered_from: nxr-e2z8sz
created_at: 2026-11-21T18:45:45Z
---

Goal: a group makes one `cargo metadata --format-version 1 --no-deps` call for its packages and its directories, and what reads the directories later takes them from the invocation (`DES-OUTPUTS`, `DES-BATCH`).

Context: finding 4 of the architecture audit after 0.6 (21 November 2026, at 54adf17). Wave: seam. The report of one such call holds `packages`, `target_directory` and `build_directory`, yet:

- `groupInvocations` (`nx-rust/src/executors/group-invocations.ts`, about lines 117-126 and 254-280) calls it twice in a row for every `build`, `napi-build` and `wasm-build` group: through `directoryReport` (`nx-rust/src/cargo/directories.ts`, about line 69) and through `specReport` (`nx-rust/src/cargo/package-specs.ts`, about line 84);
- a `test` or `bench` group that keeps files calls it again in `nx-rust/src/executors/kept-files.ts` (about line 146), because the group's report did not keep the directories; nxr-5hzxra accepted that cost while `task.ts` was being split;
- `nx-rust/src/executors/staged-run.ts` (about lines 51-55) falls back to another `reportedDirectories` call where the invocation has no directories.

It waits for nxr-2m21ya, which changes the same part of `kept-files.ts`.

- [ ] Take packages and physical directories from one report in `groupInvocations` wherever either is needed, and store the directories on `GroupInvocation`
- [ ] Let `kept-files.ts` and `staged-run.ts` read them from the invocation; keep `reportedDirectories` for callers that have no group
- [ ] Show the number of cargo calls of a batched build and of a test group that keeps files before and after, with the harness's cargo log, and correct the cost sentences of `DES-BATCH` and `VER-BATCHING` that nxr-5hzxra wrote

Done when: the counts are down as described, and `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e`, `pnpm nx format:check --all` and the Mara validation pass.
