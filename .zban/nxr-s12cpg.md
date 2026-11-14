---
title: Implement the batch executor
status: todo
type: feature
priority: high
parent: nxr-9y4eh8
blocked_by:
  - nxr-3nv4tn
  - nxr-1q1f0n
created_at: 2026-11-12T18:20:01Z
---

Goal: tasks of one group run with one cargo call for each step of their target, each with its own result and cache entry.

Implements `REQ-BATCHING` and `DES-BATCH` (`nx-rust/docs/execution.mara.md`). Checked by `VER-BATCHING`.

- [ ] `batchImplementation` and `preferBatch: true` in `executors.json`
- [ ] Grouping by kind of task, workspace, feature set, profile and target triple; groups run one after another
- [ ] One cargo call per step of the group's target (`DES-BATCH`), every step selecting the crates the same way; the output of every step mapped to a result and terminal output per task
- [ ] Select the group's crates as `DES-INVOCATION` says: `crateSelection` in `nx-rust/src/executors/command.ts` (`-p` and each crate's package ID specification, the package name for `cargo fmt`), with the specifications from one `memberSpecs` call (`nx-rust/src/cargo/package-specs.ts`) per group, in the workspace root with the group's environment. Never a bare name or `name@version`: several `-p` make a shared name ambiguous where one crate alone does not (`EVD-CARGO-PACKAGE-SPECS`). Map cargo's list of failed targets, which names members by their bare names, back to tasks by package name
- [ ] The directory check of cached `build` and `doc` (`DES-OUTPUTS`) once per group
- [ ] `--keep-going` and `--no-fail-fast`; a task succeeds only where cargo's output shows that its crate passed (`DES-BATCH`): the JSON artifacts of builds, checks and clippy, and the list of failed targets of `cargo test` (`DES-TEST-RUN`); a test step stopped by a compile error fails every test task with a message naming the crates that did not compile; a failure outside the selection is a warning
- [ ] Each task of a batch ignores the options that its target does not take, with its lines, as a single task does: call `taskOptions` (`nx-rust/src/executors/task-options.ts`) once per task, with `taskGraph.tasks[id]` as its graph task, its target's options and active configuration as `configured`, and `recordedNxCommand()` as the record; pass only `options` to the grouping, so that an ignored option splits no group, and put `warnings` at the top of the task's own terminal output. Covers the group case and `--batch=false` of `VER-UNKNOWN-OPTIONS` (two crates whose `project.json` files give an unknown option different values share their cargo commands)

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

Note: `EVD-NX-24-BATCHES` records how Nx 24.0.6 treats a batch's results, terminal output, environment and cache entries; the implementation follows it.
