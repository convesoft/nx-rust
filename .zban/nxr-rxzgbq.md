---
title: Repeat the target-default warning at the start of a task
status: todo
type: feature
parent: nxr-w9qa5f
blocked_by:
  - nxr-kmdpgj
discovered_from: nxr-d3087e
created_at: 2026-11-13T16:06:53Z
---

Goal: the warning of `DES-TARGET-DEFAULT-GUARD` (`nx-rust/docs/targets.mara.md`) for a `targetDefaults` entry that adds dependencies on other projects' tasks, such as `^build`, also appears in the output of a task of the target concerned, as "Warnings where they are seen" in `DES-DIAGNOSTICS` (`nx-rust/docs/setup.mara.md`) requires for every graph-time warning. With the Nx daemon on, the warning that `createDependencies` prints goes to the daemon's log only.

Context: nxr-d3087e prints the warning when the graph is created (`failOnTargetDefaults` in `nx-rust/src/graph/target-defaults.ts`) and from `init`. The executor does not exist yet (nxr-kmdpgj). The executor's context holds the merged targets and `nx.json`; what the plugin inferred for a target has to reach it some other way, for example by recomputing the check or through the target's metadata, which Nx keeps out of task hashes (`EVD-NX-OPTION-VALIDATION`).

- [ ] The warning in the output of a task whose target an entry changes, once per task, with the text graph creation prints
- [ ] A test with the daemon on, as the last paragraph of `VER-TARGET-DEFAULT-GUARD` (`nx-rust/docs/verification.mara.md`) describes
- [ ] Remove the sentence on this from the status note of `nx-rust/docs/targets.mara.md`

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
