---
title: A targetDefaults entry that repeats the plugin's lockfile dependency as an object is reported as replacing and adding it
status: todo
type: bug
priority: low
parent: nxr-9y4eh8
discovered_from: nxr-1q1f0n
created_at: 2026-11-14T17:44:52Z
---

Goal: `DES-TARGET-DEFAULT-GUARD` reports a `targetDefaults` entry only for what it really changes in an inferred target.

Context: seen while writing a test for nxr-621hvq, cause not investigated. In a copy of the fixture `binary-tests`, `nx.json` with `"targetDefaults": { "test": { "dependsOn": [{ "projects": ["directory:rust"], "target": "lockfile" }] } }`, which names exactly the dependency on the lockfile task that the plugin infers for every cached crate target (`DES-LOCKFILE-HASHING`), made `nx show projects` fail with two findings for every crate, also for those whose `test` has no other dependency: "It replaces the dependsOn that nx-rust declares for \"test\"" and "It adds {\"projects\":[\"directory:rust\"],\"target\":\"lockfile\"} to the dependsOn of \"test\"". So the merged entry does not compare equal to the inferred one (`lostFrom` and `includes` in `nx-rust/src/graph/target-defaults.ts`), perhaps because Nx's synthesis of target defaults changes the object. Users rarely write that entry, which is why the priority is low; a list with `"..."` is what the guidance tells them to write.

- [ ] Find out what Nx makes of an object entry of `dependsOn` from `targetDefaults` and why the comparison fails
- [ ] Compare entries as Nx's task graph normalises them, or document the limit in `DES-TARGET-DEFAULT-GUARD`
- [ ] A test in `target-defaults.spec.ts` with that entry

Done when: the entry above creates the graph without a finding for a target whose inferred `dependsOn` is exactly that entry, or the limit is recorded in Mara, and the checks pass.
