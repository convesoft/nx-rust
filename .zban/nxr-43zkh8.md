---
title: Review the decisions made in 0.5
status: todo
type: task
tags:
  - maintainer
created_at: 2026-11-16T10:41:49Z
---

Goal: the maintainer reads, once, the decisions that the control plane made on his behalf while milestone 0.5 (releasing with Nx release) was built, and overturns those he disagrees with. A decision he overturns becomes a new issue. This issue is never dispatched to a worker.

Each line says what was decided, which Mara items it rests on, and how to undo it. "Provisional" marks a decision of a kind the maintainer reserved for himself (anything that cannot be undone, a capability users see) that can still be undone before 1.0 and was therefore taken without stopping the work. Decisions before 15 November 2026, 16:30, are in the Mara items themselves and in the maintainer's own answers; this list starts with the amendments of that day. The maintainer's own answer of 15 November 2026 on uncommitted changes (a documented limit, no check with git; `RISK-UNCOMMITTED-PUBLISH`) is not listed, since it is his.

- [ ] Read the list below and overturn what is wrong

## Decisions

1. A `cargo publish` call runs with its tasks' environment without Nx's per-task variables, and tasks whose environments otherwise differ get separate calls (settled by the worker of nxr-m8evx2, accepted at integration). Rests on `DES-RELEASE` ("Batch") and the rule of `DES-BATCH` that a group has one environment. Undo: one call per task.
2. In a dry run, "another task would publish this dependency" means that the dependency's project has the publish target and its task did not fail (worker, accepted). Rests on `DES-RELEASE` (the dry run's limit). Undo: require the dependency's task to be in the same call.
3. A lookup that did not find a version is asked again before each later call (worker, accepted). Rests on `DES-RELEASE` ("Lookups"): an earlier call of the same run may have published it. Undo: ask once per run.
4. Each task's result comes from what cargo's output shows for its own crate, whatever the call's exit status: `Uploaded <name> v<version>` in a real call, the crate's `Verifying` block reaching `Finished` in a dry run; what the output does not show counts as failed, with a message that says so (review fix). Rests on `DES-RELEASE` ("Batch") and the cargo executors' rule in `DES-BATCH`. Undo: results from the exit status alone, which fails crates that cargo did verify.
5. Three cases of `VER-RELEASE` were reworded to what cargo does: the alias case (cargo always showed `alpha` and refused the upload because two names pointed to one index), the `shared` case (it needs a registry that nothing names), and the missing `registry` key case ("no upload of it": the dependency in the same call still publishes). Rests on `EVD-CARGO-PUBLISH-REGISTRIES` and the runs of nxr-m8evx2. Undo: restore the earlier wording, which the harness could not produce.
6. Provisional (an upload cannot be taken back). nxr-4884vg went to the backlog: the check of where a dependency points uses the dependent crate's environment. With per-crate dotenv files that give the crates of one release different default registries, a crate was uploaded to one registry against another registry's copy of its dependency, both tasks passing (harness only). The release guide says that the crates of one release must get their registry settings from one place. Rests on the rule that rare `.env` variants do not block. Undo: pull the issue back; the fix is to establish each dependency's registry with that dependency's own task environment.
7. nxr-ma1z22 went to the backlog: a `project.json` that sets `"cache": true` on `nx-release-publish` makes a second run report success from the cache without an upload; the release guide says not to turn caching on for that target. Nothing wrong is uploaded. Undo: pull the issue back; the fix is the run-time check that the other uncached targets have.
8. nxr-c63t0r went to the backlog: the publish executor does not run the dotenv check that the cargo executors run. Undo: pull the issue back.
