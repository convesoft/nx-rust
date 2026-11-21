---
title: Hash a build that a batch left for a following batch again once the builds it depends on have run
status: done
type: task
priority: deferred
tags:
  - deferred
  - backlog
related:
  - nxr-yfh7zh
discovered_from: nxr-k63csj
created_at: 2026-11-20T13:58:32Z
closed_at: 2026-11-20T20:41:38Z
---

Goal: a `build` that the batch executor leaves for a following batch is stored under the cache key that Nx would compute once its dependencies have run, so that a repeated command restores it (`DES-BATCH`, "Tasks left for a following batch"; `EVD-NX-24-BATCHES`).

Context: found by the review of nxr-k63csj at commit f008376. Nx 24.0.6 hashes every task of a batch before the batch runs, and keeps that hash for a task that the batch left out (`applyFromCacheOrRunBatch` in `nx/dist/src/tasks-runner/task-orchestrator.js`); by the time the task runs, Nx has removed its completed dependency and does not hash again. Reproduction of the reviewer: in the three-wave fixture of `nx-rust/test/batch-deferral.spec.ts`, add `{ "dependentTasksOutputFiles": "**/pb" }` to the inferred `build` inputs through `inputs: ["...", …]`, run the three builds cold, delete the executables but keep the cache, and repeat the command: `pa` and `pb` are restored, and `pc` runs cargo again. The run on record showed a cache miss. The cold run's cache trace of the re-check shows Nx asking for and storing `pc` under the hash it computed before `pb` ran, so a hit under that key on a result built from another output of `pb` is not excluded: it would need the output of `pb` to change for a reason that the key of `pc` covers only through that input. It needs a `build` that declares another build's output files as an input, as for a code generator.

- [x] Check whether the same early hash applies to a batch that leaves no task out, and whether Nx offers the executor a way to have a task hashed again
- [x] Settle, with a run, whether the early key can match a result built from another output of the dependency; if it can, this is a cache-correctness defect (`GOAL-TRUSTED-CACHE`) and leaves the backlog
- [x] Remove the limit, or keep its sentence in `DES-BATCH` and close this issue with the reason

Done when: the repeated command restores all three builds, or the limit is recorded as accepted, and `pnpm nx run-many -t build lint test` passes.

## Findings from nxr-yfh7zh (20 November 2026)

- The remedy of nxr-yfh7zh does not settle this issue: it keeps the files of the command's other builds on disk (`DES-BATCH`, "Files that a batch leaves on disk") and changes neither when Nx hashes a task nor which tasks a batch leaves for a following one.
- Read in Nx 24.0.6 (`tasks-runner/task-orchestrator.js`, lines 646 to 690 and 763 to 776), not run: in each wave, a task whose inputs read other tasks' outputs and that runs behind a miss gets a preliminary hash and is marked to be hashed again once the batch process reports it (`rehashAfterRun`). A task that the plugin leaves out is not reported in that wave, so it keeps the preliminary hash; in the later wave its dependencies have ended, so it is looked up, not run behind a miss, and `hashBatchTasks` skips a task that has a hash. The early key is therefore both looked up and stored, as the cache trace on record shows.
- Whether the early key can give a wrong hit, by reasoning only: the key is computed from the dependency's outputs as they lie on disk before the dependency runs. In a fresh checkout, or wherever those outputs are absent, every run computes it with the outputs absent, so `dependentTasksOutputFiles` adds nothing to the key; a change of the dependency's output that the key covers only through that input (a code generator that reads something outside its own key) would then hit an entry built from the earlier output. This answers the first unchecked item above: a batch that leaves no task out reports such a task in the wave that marked it, so Nx hashes it again after the run; and a batch result has no field that asks Nx to hash a task again (`TaskResult` in `config/misc-interfaces.d.ts`). The second item still needs a run.
- A remedy that this issue did not have before: since a batch now puts back the files of the command's other builds after each group, two whole-workspace `build` groups of one workspace root could run in one batch process again without storing each other's files, so that the batch would leave no `build` for a following batch and no build would keep an early key. That reverses the decision of line 15 of nxr-5rrkay (leave the second group for a following batch), so it needs the maintainer.

Note from nxr-yfh7zh, phase 1 (20 November 2026): the maintainer chose staged builds (`ADR-STAGED-BUILDS`), with which no build is left for a following batch. A throwaway prototype ran the reviewer's reproduction of the wrong hit and built `pb` again with the new value (`EVD-STAGED-BUILDS`). nxr-yfh7zh's phase 2 closes this issue if its test shows the same.

## Summary of Changes

Settled by nxr-yfh7zh. The review of nxr-yfh7zh at d0971e5 settled the second item with a run: the early key gave a wrong hit (`pb` restored as `old` after `pa` was rebuilt as `new`), so this was a cache-correctness defect. The maintainer's decision for staged builds (`ADR-STAGED-BUILDS`) removed its cause: no group writes another task's files, so a batch leaves no `build` for a following batch process, and Nx hashes a task whose inputs read other tasks' outputs again once the batch process has reported it (`DES-BATCH`, "Every task in the batch that receives it"). The limit's sentence is gone from `DES-BATCH`.

Check: the test "build pb again where its key reads pa's output and pa changed, instead of restoring it under an early key (nxr-f04xen)" in `nx-rust/test/batch-builds.spec.ts` runs the reviewer's reproduction through the real Nx batch runner and cargo, and `pb` prints the new value; `VER-BATCHING` ("Staged builds") names it. It passes with leaving out removed and staging switched off too, which shows that removing the leaving out settles it.
