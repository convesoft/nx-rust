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

The executor of nxr-kmdpgj runs one cargo command per task; the batch implementation of nxr-s12cpg has to apply the same handling, so keep it in a function both can call.

- [ ] The executor's schema declares the target options with their types and leaves `additionalProperties` unset
- [ ] Unknown keys stay out of the cargo command, with one warning line per key at the top of the task's output
- [ ] The line names the option, the task and its source (command line, `targetDefaults` key, or the crate folder's own files) and, for a target default, suggests both fixes
- [ ] Tests for the cases of `VER-UNKNOWN-OPTIONS` that one cargo call per task can show, with `--batch=false` for now

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
