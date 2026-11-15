---
title: Judge other layers by Nx's native hash plan, not by a re-derived reading of the lists
status: todo
type: bug
parent: nxr-9y4eh8
discovered_from: nxr-vnb0ph
created_at: 2026-11-15T13:54:25Z
---

Goal: `DES-TARGET-DEFAULT-GUARD` ("Other layers") refuses exactly what makes Nx hash less for an inferred target, and nothing that leaves Nx's hash plan unchanged. `RISK-GUARD-HASH-PLAN` is then mitigated or retired.

Context: nxr-vnb0ph made graph creation fail where another plugin takes away or narrows an inferred target's `inputs`, `outputs` or `dependsOn`. The guard judges `inputs` by expanding them the way the JS helpers of Nx's `dist/src/hasher/task-hasher.js` do. Nx hashes a task by the plan of its native `HashPlanner`, which `NativeTaskHasherImpl` builds from `nx.json` and the project graph with its unexpanded inputs (`EVD-NX-24-PLUGIN-NODES`, "What a list means"). The re-check of commit 3e710b1 (15 November 2026, real Nx 24.0.6, both plugin modes) found the cases below, all in `subfolder-workspace` with a plugin listed after nx-rust that contributes to `rust/crates/api`. Code references are to `nx-rust/src/graph/target-defaults.ts` at 3e710b1.

- [ ] Find out whether the native planner can be called at graph creation, in `createDependencies`, for the merged projects and for the guard's rebuild. Nx's `HashPlanInspector` (`nx/src/hasher/hash-plan-inspector.js`) builds a `HashPlanner` from a project graph and `nx.json`, and `inspectTaskInputs` returns a task's planned inputs. Note what it needs (file maps, a task graph) and what it costs on the largest fixture.
- [ ] If it can, compare the planned inputs of each inferred target for the merged graph and for the rebuild from nx-rust's node, `targetDefaults` and the crate folder's own files, in place of the re-derived reading. Keep the rule: an error unless the crate's own files, `nx.json` or a blamed `targetDefaults` entry explain the difference. Otherwise close cases 1 to 3 one by one in the existing reading.
- [ ] Case 1, a loss that passes. The plugin contributes `namedInputs: { narrow: ["!{projectRoot}/src/**/*"] }` and `check.inputs: ["...", { "input": "narrow", "dependencies": false }]`. The guard expands an object input only where `dependencies` is absent (about line 612), while Nx takes `false` as a self input and expands it. Graph creation passes, a change to `api/src/lib.rs` leaves `api:check`'s hash unchanged, and a `compile_error!` gives a cached success.
- [ ] Case 2, a loss that passes. `rust/crates/model/project.json` defines `selfFiles`, and `model`'s targets read it in place of `default`. A later plugin defines `default` for `model` as `["{projectRoot}/Cargo.toml"]`. `api:check` reads `model` through `^default`, which the guard keeps as written without comparing the referenced project's definition (about line 602). A change to `model/src/lib.rs` leaves `api:check`'s hash unchanged; a `compile_error!` there gives a cached success.
- [ ] Case 3, two false refusals. A later plugin adds `"!{workspaceRoot}/rust/crates/api/src/**/*"`, or `{ "fileset": "!{projectRoot}/src/**/*", "dependencies": true }`, to `api:check`. The guard refuses both, because `leavesOut` (about line 657) counts every added pattern that starts with `!`. The native plan shows the same file sets before and after, and source changes still change the hash.
- [ ] Case 4, the reading of absent inputs. For a crate target without `inputs` from a later plugin, with a project-level `default` of `["{projectRoot}/Cargo.toml"]`, the native plan held `api:rust/crates/api/**/*`, and source edits still changed the hash. The JS helpers' expansion of `DEFAULT_INPUTS` through that `default`, which the guard copies, does not give that.
- [ ] Tests with the real Nx in both plugin modes: each case first, then its fix; the existing tests of "another layer" stay green. Update `DES-TARGET-DEFAULT-GUARD`, `VER-TARGET-DEFAULT-GUARD` and `RISK-GUARD-HASH-PLAN` (mitigated, or retired where nothing is left).
