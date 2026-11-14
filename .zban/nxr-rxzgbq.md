---
title: Repeat the target-default warning at the start of a task
status: in-progress
type: feature
parent: nxr-w9qa5f
blocked_by:
  - nxr-kmdpgj
discovered_from: nxr-d3087e
created_at: 2026-11-13T16:06:53Z
---

Goal: the warning of `DES-TARGET-DEFAULT-GUARD` (`nx-rust/docs/targets.mara.md`) for a `targetDefaults` entry that adds dependencies on other projects' tasks, such as `^build`, also appears in the output of a task of the target concerned, as "Warnings where they are seen" in `DES-DIAGNOSTICS` (`nx-rust/docs/setup.mara.md`) requires for every graph-time warning. With the Nx daemon on, the warning that `createDependencies` prints goes to the daemon's log only.

Context: nxr-d3087e prints the warning when the graph is created (`failOnTargetDefaults` in `nx-rust/src/graph/target-defaults.ts`) and from `init`. The executor exists since nxr-kmdpgj (`nx-rust/src/executors/`, `taskInvocation` in `task.ts`), but prints no graph-time warning yet. The executor's context holds the merged targets and `nx.json`; what the plugin inferred for a target has to reach it some other way, for example by recomputing the check or through the target's metadata, which Nx keeps out of task hashes (`EVD-NX-OPTION-VALIDATION`).

- [ ] The warning in the output of a task whose target an entry changes, once per task, with the text graph creation prints
- [ ] A test with the daemon on, as the last paragraph of `VER-TARGET-DEFAULT-GUARD` (`nx-rust/docs/verification.mara.md`) describes
- [ ] Remove the sentence on this from the status note of `nx-rust/docs/targets.mara.md`

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Notes (14 November 2026)

Stopped before implementing, because the route to the cache key is a product choice. The question is with the maintainer.

Since nxr-w627dj, a warning that the executor prints is part of its project's tasks' keys, through the named input `nx-rust-warnings` that `createNodes` gives the project (`DES-DIAGNOSTICS`, "Warnings where they are seen"). Without that, a cache hit replays a stale state of this warning. Nx's hash of the project's configuration leaves out `dependsOn` (`EVD-NX-OPTION-VALIDATION`), so a `targetDefaults` entry that adds `^build` changes no key by itself.

- To the executor: `createMetadata`, which Nx 24 runs after `createDependencies` with the merged project graph, can add the text that `createDependencies` found to the projects' metadata (`applyProjectMetadata` in `nx/dist/src/project-graph/build-project-graph.js`). Recomputing the check in the executor would need the targets as the plugin inferred them, which the executor does not have.
- To the key: only `createNodes` can set named inputs, and it does not see what `createDependencies` sees: the projects of other plugins and entries (which turn a finding into the "cannot tell which configuration changed it" warning), and every project name, against which Nx resolves a `dependsOn` entry's `projects` patterns and `<project>:<target>`. No hook after `createNodes` can change a key, except a new runtime input on every Rust target, which would change the keys of every repository.

Options for the maintainer:

- A. `createNodes` computes the warning itself, with the check's own rebuild over the layers it can see (its projects, the `targetDefaults` synthesis, the folders' `project.json` and `package.json`), and resolves `dependsOn` against its own projects. Graph creation, the task output and the key then always agree. The guard loses precision: an entry whose `projects` pattern names only projects outside the entry draws no warning, and where another plugin changes the target both warnings appear.
- B. `createNodes` digests the cause, the `dependsOn` entries that the elements of `targetDefaults` laid over the project's targets add (from Nx's synthesis), and `createMetadata` carries the exact text of `createDependencies` to the executor. The key follows the entry, not the text: a change that touches only the paragraph's list of projects (such as a new crate) leaves the other crates' hits showing the old list, and entries that add only same-project dependencies cause reruns without a warning.
- C. Do not key this warning: `createMetadata` carries the text, and `DES-DIAGNOSTICS` states that a hit can replay a stale state of it.

The implementer's recommendation is B. The other `createDependencies` warning, for a target that changed where the plugin cannot tell why, has the same problem (nxr-9p91st).
