---
title: Implement the batch executor
status: todo
type: feature
priority: high
parent: nxr-9y4eh8
blocked_by:
  - nxr-3nv4tn
created_at: 2026-11-12T18:20:01Z
---

Goal: tasks of one group run as one cargo call, each with its own result and cache entry.

Implements `REQ-BATCHING` and `DES-BATCH` (`nx-rust/docs/execution.mara.md`). Checked by `VER-BATCHING`.

- [ ] `batchImplementation` and `preferBatch: true` in `executors.json`
- [ ] Grouping by kind of task, workspace, feature set, profile and target triple; groups run one after another
- [ ] One cargo call per group; cargo's output mapped to a result and terminal output per task
- [ ] `--keep-going` and `--no-fail-fast`; a task fails through its own crate or a crate it depends on, and a failure outside the selection is a warning

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
