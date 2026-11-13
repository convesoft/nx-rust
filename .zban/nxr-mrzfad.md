---
title: Read the executors' declared options in one place once nxr-95kg91 and nxr-wea5vt have both landed
status: todo
type: task
parent: nxr-w9qa5f
blocked_by:
  - nxr-wea5vt
related:
  - nxr-wea5vt
discovered_from: nxr-95kg91
created_at: 2026-11-13T17:05:26Z
---

Goal: the graph-time check of `REQ-UNKNOWN-METADATA-OPTIONS` and the task-time handling of `REQ-UNKNOWN-OPTIONS` read the options that each executor declares through one function, and share one table of the options each target takes (`DES-UNKNOWN-OPTIONS`, `DES-PLUGIN-OPTIONS`).

Context: the two issues were built in parallel on the same `main`. nxr-95kg91 reads each executor's schema `properties` through `declaredExecutorOptions()` in `nx-rust/src/executors/declared-options.ts`, which follows `executors.json`. nxr-wea5vt (pull request #35) reads them in each executor with `declaredOptions(join(__dirname, "schema.json"))` in `nx-rust/src/executors/task-options.ts`. Both add `optionTargets`/`targetTakes` to `nx-rust/src/executors/command.ts` in the same shape; #35's version also has `args`. Whichever pull request merges second has to resolve the conflict in `command.ts` and the Configuration page's status note. If the merge has not already done the steps below, do them here.

- [ ] Keep one `optionTargets`/`targetTakes` in `command.ts`, with `args` on `run`
- [ ] Make the executors and the graph check use one reader of the schemas' `properties`, and remove the other
- [ ] Change the test in `nx-rust/test/run-arguments.spec.ts` in which a crate's `[package.metadata.nx.targets.build.options]` sets `allTargets`: graph creation now rejects it, so it can expect that error, or set the option through `project.json` or `targetDefaults` to keep checking the task's warning line
- [ ] Remove the sentence about nxr-95kg91 from the status note of `nx-rust/docs/configuration.mara.md`

Done when: `rg "readFileSync" nx-rust/src/executors` shows one reader of schema files, and `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e`, `mara project validate` and `zban check` pass.
