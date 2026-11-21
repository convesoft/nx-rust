---
title: "Split the other large source modules by concern: caching, discovery, cargo-output and stage"
status: todo
type: task
priority: deferred
tags:
  - deferred
  - backlog
blocked_by:
  - nxr-aa287j
  - nxr-mdpha2
  - nxr-f2j7ec
discovered_from: nxr-e2z8sz
created_at: 2026-11-21T18:46:42Z
---

Goal: each of these modules holds one concern. No behaviour changes.

Context: finding 11 of the architecture audit after 0.6 (21 November 2026, at 54adf17). Wave: split, after the seam and behavior issues that change the same files. Each pairs concerns that change for different reasons:

- `nx-rust/src/executors/stage.ts` (605 lines): the stage folder's life and the liveness of its owner; finding and moving staged artifacts; and the refusal of two builds into one folder (`sharedBuildFolders`), which nxr-aa287j moves to the shared reading of outputs;
- `nx-rust/src/executors/cargo-output.ts` (832 lines): the JSON messages of cargo (`readJsonStep`), the text of `cargo test` (`readTestStep`), and ANSI and diagnostic helpers;
- `nx-rust/src/graph/discovery.ts` (853 lines): finding and claiming Cargo workspaces (`claimWorkspaces`), and the wiring into Nx's graph;
- `nx-rust/src/graph/caching.ts` (868 lines): reading Cargo's directories and configuration, and the policy of what is cached with its warnings.

- [ ] One commit per module, each followed by `pnpm nx run-many -t build lint test`
- [ ] Move code only; keep the `// @mara implements` markers and compare the code links before and after
- [ ] Change no test file except import lines

Done when: the four are split, the Mara links are the same, and `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e`, `pnpm nx format:check --all` and the Mara validation pass.
