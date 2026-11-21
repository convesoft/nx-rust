---
title: Share the executor helpers that are copied between executors, release and graph
status: todo
type: task
priority: deferred
tags:
  - deferred
  - backlog
blocked_by:
  - nxr-rxetx7
  - nxr-es2rrj
discovered_from: nxr-e2z8sz
created_at: 2026-11-21T18:46:02Z
---

Goal: each of these small helpers exists once.

Context: finding 7 of the architecture audit after 0.6 (21 November 2026, at 54adf17). Wave: seam. Identical or near-identical copies:

- `contextOf`: `nx-rust/src/executors/batch.ts` (about lines 522-531) and `nx-rust/src/release/publish-environments.ts` (341-350);
- `configuredOptions`: `nx-rust/src/executors/task-guards.ts` (308-314) and `publish-environments.ts` (353-359);
- `shellQuote`: `nx-rust/src/graph/artifact-kinds.ts` (58-60) and `nx-rust/src/graph/inputs.ts` (944-946);
- `escapeGlob`: `nx-rust/src/executors/input-check.ts` (306-308), `nx-rust/src/graph/declared-files.ts` (570-572) and `nx-rust/src/graph/visibility.ts` (72-74);
- the run of `cargo affected status`, with signal forwarding and the temporary report folder: `nx-rust/src/executors/affected-run.ts` (398-452) and `nx-rust/src/executors/coverage-baseline.ts` (302-360), about 55 lines each; signal forwarding again in `task-execution.ts` (about 131) and `group-run.ts` (687);
- `messageOf`: `nx-rust/src/executors/stage.ts` (475-477) and `nx-rust/src/executors/kept-files.ts` (428-430).

- [ ] One export for each, in the module that owns the concern, and the copies removed
- [ ] Say in the summary where two copies differed and which behaviour was kept

Done when: `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e` and `pnpm nx format:check --all` pass.
