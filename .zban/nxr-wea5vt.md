---
title: Ignore unknown options in the cargo executors and give run its args option
status: todo
type: feature
parent: nxr-w9qa5f
blocked_by:
  - nxr-kmdpgj
related:
  - nxr-s12cpg
discovered_from: nxr-wynx3g
created_at: 2026-11-13T11:02:52Z
---

Goal: the plugin's executors do what `REQ-UNKNOWN-OPTIONS` and `DES-UNKNOWN-OPTIONS` (`nx-rust/docs/configuration.mara.md`) prescribe, and `run` takes the `args` option of `DES-TARGET-COMMANDS` (`nx-rust/docs/targets.mara.md`).

The executor of nxr-kmdpgj comes first. The batch implementation of nxr-s12cpg and the executor of `run` reuse the same code.

- [ ] The schemas, as the first paragraph of `DES-UNKNOWN-OPTIONS` says, and the `args` option of `run` as a string
- [ ] The comparison and the warning line, as its paragraphs "Source" and "Command line" say
- [ ] The same line for an option that the schema declares but that the option reference of `DES-PLUGIN-OPTIONS` does not give the task's target, such as `targetTriple` on `test` or `allTargets` on `build`, saying that the target does not take it (`DES-UNKNOWN-OPTIONS`, second paragraph). Since nxr-kmdpgj the command leaves such an option out without a word (`cargoArguments` in `nx-rust/src/executors/command.ts`); the case in `VER-UNKNOWN-OPTIONS` checks the line
- [ ] The `preTasksExecution` hook and its record, as its paragraph "Record" says
- [ ] The arguments of `run`, as its paragraph "run" and the "run" paragraph of `DES-TARGET-COMMANDS` say
- [ ] Tests for the cases of `VER-UNKNOWN-OPTIONS` and the `run` cases of `VER-TARGETS` that one cargo call per task can show

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
