---
title: Ignore unknown options in the cargo executors and give run its args option
status: done
type: feature
parent: nxr-w9qa5f
blocked_by:
  - nxr-kmdpgj
related:
  - nxr-s12cpg
discovered_from: nxr-wynx3g
created_at: 2026-11-13T11:02:52Z
closed_at: 2026-11-13T16:46:03Z
---

Goal: the plugin's executors do what `REQ-UNKNOWN-OPTIONS` and `DES-UNKNOWN-OPTIONS` (`nx-rust/docs/configuration.mara.md`) prescribe, and `run` takes the `args` option of `DES-TARGET-COMMANDS` (`nx-rust/docs/targets.mara.md`).

The executor of nxr-kmdpgj comes first. The batch implementation of nxr-s12cpg and the executor of `run` reuse the same code.

- [x] The schemas, as the first paragraph of `DES-UNKNOWN-OPTIONS` says, and the `args` option of `run` as a string
- [x] The comparison and the warning line, as its paragraphs "Source" and "Command line" say
- [x] The same line for an option that the schema declares but that the option reference of `DES-PLUGIN-OPTIONS` does not give the task's target, such as `targetTriple` on `test` or `allTargets` on `build`, saying that the target does not take it (`DES-UNKNOWN-OPTIONS`, second paragraph). Since nxr-kmdpgj the command leaves such an option out without a word (`cargoArguments` in `nx-rust/src/executors/command.ts`); the case in `VER-UNKNOWN-OPTIONS` checks the line
- [x] The `preTasksExecution` hook and its record, as its paragraph "Record" says
- [x] The arguments of `run`, as its paragraph "run" and the "run" paragraph of `DES-TARGET-COMMANDS` say
- [x] Positional words after `--` on a target other than `run` count as passed on the command line under the same three conditions, with the words in place of a flag, as nxr-abrp5n recommends and the maintainer decided; one sentence each in `DES-UNKNOWN-OPTIONS` and `VER-UNKNOWN-OPTIONS`, and the guidance in `targets.mara.md`
- [x] Tests for the cases of `VER-UNKNOWN-OPTIONS` and the `run` cases of `VER-TARGETS` that one cargo call per task can show

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Summary of Changes

- **Record.** The plugin's `preTasksExecution` hook (`nx-rust/src/executors/nx-command.ts`, registered in `nx-rust/src/index.ts`) writes the `nx` command's `argv` as JSON to `NX_RUST_NX_COMMAND` on every command. Checked against the installed `nx` 24.0.6: Nx calls the hook once per plugin entry from `runCommand` (`tasks-runner/run-command.js`) before `nx run`, `run-many` and `affected` run tasks; with the daemon on it runs in the daemon, under plugin isolation in a plugin worker, and Nx records the assignment to `process.env` there and applies it to the `nx` process, whose task processes inherit it (`project-graph/plugins/tasks-execution-hooks.js`, `loaded-nx-plugin.js`). The tests show the record in tasks with the daemon on and off and isolation on and off. A record over 64 KiB is left empty and counts as missing: Linux refuses an environment variable over 128 KiB, which would fail every task of such a command (recorded in `DES-UNKNOWN-OPTIONS`, "Record"). A second record, `NX_RUST_RUN_ID` of nxr-xq9ava, goes into `commandRecords` there; its step in nxr-xq9ava says so.
- **Comparison and lines.** `taskOptions` in `nx-rust/src/executors/task-options.ts` sorts a task's options against the executor's schema (read from the `schema.json` beside each executor) and the option reference (`optionTargets` in `command.ts`, which `cargoArguments` uses too). An undeclared option, or a declared one the target does not take, stays out of the command and gets one line at the top of the task's output; "passed on the command line" only under the three conditions, otherwise the configuration form naming `nx show target`, `sourceMap`, a `filter` and an empty entry keyed by the executor. Positional words (`_`) follow the same conditions (nxr-abrp5n). The functions take one task's data, for reuse by the batch (step added to nxr-s12cpg). `runTask` only prints the lines.
- **run.** `args` (a string in `run/schema.json`) is split as `DES-TARGET-COMMANDS` says (`split-words.ts`); an unterminated quote or a trailing backslash fails the task with a message naming `args`. The arguments after `--` go to the binary under the three conditions of `DES-UNKNOWN-OPTIONS`, "run", with Nx's own `yargs-parser` for what Nx parses from them; `run`'s own options among them keep their configured value.
- **Mara.** `DES-UNKNOWN-OPTIONS`: the `_` sentence, the record limit, and the example line now names the executor as the executor prints it. `VER-UNKNOWN-OPTIONS`: the `_` sentence. Guidance and status notes in `targets.mara.md` and `configuration.mara.md`.
- **Tests.** `nx-rust/test/unknown-options.spec.ts` (`VER-UNKNOWN-OPTIONS`), `run-arguments.spec.ts` (the `run` cases of `VER-TARGETS` and `VER-UNKNOWN-OPTIONS`), `split-words.spec.ts`, and one end-to-end case through the installed package. Not shown, because targets are neither cached nor batched yet: the cache-hit replay and the restored keys (new issue nxr-e2mz9s, after nxr-fy4t4k) and the group case (step in nxr-s12cpg). After the review: `--args` given before `--` does not reach the binary, with the daemon on and off (`run-arguments.spec.ts`), and, with the metadata tables of nxr-xyq7c8 merged, a test in which a crate's own `[package.metadata.nx.targets.run]` tables set `args`, `continuous` and `dependsOn`, and `[package.metadata.nx.targets.build.options]` sets `allTargets`, which `build` does not take: graph creation accepts it until nxr-95kg91 rejects it there, and the task leaves it out with the configuration form of the line. The `project.json` tests stay, since that source stays valid. The merge of `origin/main` conflicted only in the status note of `configuration.mara.md`: main's note is kept, and its sentence about nxr-95kg91 says what the task does meanwhile.

Checks run after the review and the merge of `origin/main` at 65d5338: `pnpm nx run-many -t build lint test` (19 suites, 521 tests passed), `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e` (20 tests passed), `mara schema validate`, `mara project validate` (valid, evaluation complete, no diagnostics), `zban check`. Before the review: the same checks, with 18 suites and 449 tests, and 18 end-to-end tests.
