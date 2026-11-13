---
title: Run tasks without options the executor does not know and warn in their output
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

Goal: an option that reaches the cargo executor from a `targetDefaults` entry, a `project.json`, a `package.json` or the command line, and that the executor does not know, changes nothing that cargo does, and the task's output says so.

Implements `REQ-UNKNOWN-OPTIONS` and the task-time part of `DES-UNKNOWN-OPTIONS` (`nx-rust/docs/configuration.mara.md`), decided in `ADR-UNKNOWN-OPTIONS`. Checked by the first paragraph of `VER-UNKNOWN-OPTIONS`. `EVD-NX-OPTION-VALIDATION` has the Nx behaviour this relies on.

The executor of nxr-kmdpgj runs one cargo command per task; the batch implementation of nxr-s12cpg and the executor of `run` (`DES-TARGET-COMMANDS`) have to apply the same handling, so keep it in a function all of them can call. On `run`, the arguments after `--` go to the binary; the plugin's `preTasksExecution` hook tells the executor whether the command had `--` (the "run" paragraph of the design).

- [ ] Each executor's schema declares the target options with their types and leaves `additionalProperties` unset
- [ ] Unknown keys stay out of the cargo command, with one warning line per key at the top of the task's output
- [ ] The line names the option, the task and the source that the "Source" paragraph of `DES-UNKNOWN-OPTIONS` prescribes, with its fixes, and falls back to `nx show target` when no source gives the received value
- [ ] The `preTasksExecution` hook and the `run` executor's handling of the arguments after `--`
- [ ] Tests for the cases of `VER-UNKNOWN-OPTIONS` that one cargo call per task can show, with `--batch=false` for now

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
