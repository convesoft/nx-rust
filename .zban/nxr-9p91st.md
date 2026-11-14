---
title: Repeat the warning for a Rust target that changed for a reason the plugin cannot tell at the start of a task
status: in-progress
type: feature
parent: nxr-w9qa5f
blocked_by:
  - nxr-rxzgbq
related:
  - nxr-rxzgbq
discovered_from: nxr-rxzgbq
created_at: 2026-11-14T09:17:48Z
---

Goal: the warning of `DES-TARGET-DEFAULT-GUARD` for an inferred target that differs from what the plugin inferred, where the plugin cannot tell which configuration changed it (such as another plugin listed in `nx.json`), reaches the output of the target's tasks as "Warnings where they are seen" in `DES-DIAGNOSTICS` requires, without a cache hit replaying a stale state of it.

Context: found while working on nxr-rxzgbq. Like the warning for an entry that adds dependencies, this one is found by `createDependencies` (`unattributedWarning` in `nx-rust/src/graph/target-defaults.ts`), which can change neither a project's metadata nor its named inputs, so it reaches only graph creation's output (the daemon's log with the daemon on) and `init`. `DES-DIAGNOSTICS` now states this. How such a warning reaches the executor and the key is the open question of nxr-rxzgbq; this issue follows its answer.

- [ ] Apply the route that nxr-rxzgbq settles to this warning, with a test that runs a task of the changed target with the daemon on
- [ ] Update `DES-DIAGNOSTICS` and `VER-TARGET-DEFAULT-GUARD`

Done when: the parts of the cited verification that cover this warning pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
