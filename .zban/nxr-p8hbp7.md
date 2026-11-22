---
title: "Split release/publish.ts: the checks before publishing into a module of their own"
status: todo
type: task
priority: deferred
tags:
  - deferred
  - backlog
blocked_by:
  - nxr-mdpha2
discovered_from: nxr-h52ghk
created_at: 2026-11-22T16:50:58Z
---

Cites: `DES-RELEASE`.

Goal: `nx-rust/src/release/publish.ts` holds the ordering and running of the publish calls, and the checks of a task and its dependencies live beside it. No behaviour changes.

Context: finding 10 of the architecture audit after 1.0.0-rc.2 (22 November 2026, at 66964f3), first suggested by the worker of nxr-c63t0r. Wave: split, after the seam and behavior issues. The file is about 810 lines and pairs the orchestration (`publishTasks`, `Publisher.run`, `runCall`, `orderCalls`) with about 355 lines of checks per dependency and of registry disagreements (`disagreements`, `disagreement`, `reachesCargo`, `dependencyTarget`, `checkTask`), which need only the root, the crates, the registry, the dotenv state and the refused tasks.

- [ ] Move those five into `nx-rust/src/release/publish-checks.ts`
- [ ] Move code only; keep the `// @mara implements` markers and compare the code links before and after
- [ ] Change no test file except import lines

Done when: the file is split, the Mara links are the same, and `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e`, `pnpm nx format:check --all` and the Mara validation pass.
