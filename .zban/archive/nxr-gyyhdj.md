---
title: A targetDefaults entry that repeats the plugin's lockfile dependency as an object is reported as replacing and adding it
status: done
type: bug
priority: low
parent: nxr-9y4eh8
discovered_from: nxr-1q1f0n
created_at: 2026-11-14T17:44:52Z
closed_at: 2026-11-15T09:31:57Z
---

Goal: `DES-TARGET-DEFAULT-GUARD` reports a `targetDefaults` entry only for what it really changes in an inferred target.

Context: seen while writing a test for nxr-621hvq, cause not investigated. In a copy of the fixture `binary-tests`, `nx.json` with `"targetDefaults": { "test": { "dependsOn": [{ "projects": ["directory:rust"], "target": "lockfile" }] } }`, which names exactly the dependency on the lockfile task that the plugin infers for every cached crate target (`DES-LOCKFILE-HASHING`), made `nx show projects` fail with two findings for every crate, also for those whose `test` has no other dependency: "It replaces the dependsOn that nx-rust declares for \"test\"" and "It adds {\"projects\":[\"directory:rust\"],\"target\":\"lockfile\"} to the dependsOn of \"test\"". So the merged entry does not compare equal to the inferred one (`lostFrom` and `includes` in `nx-rust/src/graph/target-defaults.ts`), perhaps because Nx's synthesis of target defaults changes the object. Users rarely write that entry, which is why the priority is low; a list with `"..."` is what the guidance tells them to write.

- [x] Find out what Nx makes of an object entry of `dependsOn` from `targetDefaults` and why the comparison fails
- [x] Compare entries as Nx's task graph normalises them, or document the limit in `DES-TARGET-DEFAULT-GUARD`
- [x] A test in `target-defaults.spec.ts` with that entry

Done when: the entry above creates the graph without a finding for a target whose inferred `dependsOn` is exactly that entry, or the limit is recorded in Mara, and the checks pass.

## Summary of Changes

Cause: Nx changed nothing in the entry from `targetDefaults`. It changed the plugin's own record. With the plugin in Nx's own process (`NX_ISOLATE_PLUGINS=false`), Nx 24.0.6 merges a plugin's lists without copying them, puts a placeholder object in place of each project name in `dependsOn` and `inputs` after the plugin's batch (`registerNameRefs`), and after the merge writes the final names back only into lists that are still in the merged configuration (`applySubstitutions`, `project-graph/utils/project-configuration/name-substitution-manager.js`). An entry that replaces `test`'s `dependsOn` left the placeholder for `directory:rust` in the plugin's record, so `lostFrom` and `includes` compared the merged `{ projects: ["directory:rust"], target: "lockfile" }` with `{ projects: [<placeholder>], target: "lockfile" }`. In a plugin worker, Nx's default, the record stayed intact, and only the crates whose `test` also depends on `build` were reported, which is correct. Recorded as `EVD-NX-24-PLUGIN-NODES`.

Fix: `createNodes` returns a `structuredClone` of its project nodes (`nx-rust/src/graph/registration.ts`). The comparison is unchanged: entries are still equal only as JSON with sorted keys, so `projects`, `target`, `dependencies`, `params`, `options`, `inputs` and `waitFor` all have to match exactly. `DES-TARGET-DEFAULT-GUARD` ("Where") says that `createNodes` hands Nx a copy, and `VER-TARGET-DEFAULT-GUARD` lists the new cases.

Tests (`target-defaults.spec.ts`, real Nx): the entry keyed `test` in `subfolder-workspace` creates the graph without a finding, both in Nx's own process and in a worker. In `binary-tests`, in both modes, it is reported only as replacing the `dependsOn` of app, benched, gated and harnessless, with no added dependency. Near misses are still reported as replacing: another target, the workspace project by its name, `dependencies: true`, `params: "forward"`, `options: "forward"`, and an empty list.

Found and filed separately: nxr-6prnx1. A declared `dependsOn` on a project that a `project.json` renames makes the guard unable to attribute the target. That was already so in Nx's default mode, and since this change it is so in Nx's own process too, where Nx's write-back used to hide it by accident.

Checks run on the head after merging local `main`: `NX_DAEMON=false pnpm nx run-many -t build lint test --skip-nx-cache` (8 tasks succeeded; Jest rerun with static output: 45 suites, 1445 passed, 1 todo), `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` (`valid: true`, evaluation complete, no diagnostics), `zban check`. `pnpm nx e2e nx-rust-e2e` was not run: the built plugin changes only in returning a copy of the same nodes.

Later in the same branch: the review of this change brought nxr-6prnx1 in, which renames declared references as Nx does and judges each field on its own; see its summary.
