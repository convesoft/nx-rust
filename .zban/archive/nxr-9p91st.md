---
title: Repeat the warning for a Rust target that changed for a reason the plugin cannot tell at the start of a task
status: done
type: feature
parent: nxr-w9qa5f
blocked_by:
  - nxr-rxzgbq
related:
  - nxr-rxzgbq
discovered_from: nxr-rxzgbq
created_at: 2026-11-14T09:17:48Z
closed_at: 2026-11-14T09:51:56Z
---

Goal: the warning of `DES-TARGET-DEFAULT-GUARD` for an inferred target that differs from what the plugin inferred, where the plugin cannot tell which configuration changed it (such as another plugin listed in `nx.json`), reaches the output of the target's tasks as "Warnings where they are seen" in `DES-DIAGNOSTICS` requires, without a cache hit replaying a stale state of it.

Context: found while working on nxr-rxzgbq. Like the warning for an entry that adds dependencies, this one is found by `createDependencies` (`unattributedWarning` in `nx-rust/src/graph/target-defaults.ts`), which can change neither a project's metadata nor its named inputs, so it reaches only graph creation's output (the daemon's log with the daemon on) and `init`. `DES-DIAGNOSTICS` now states this. How such a warning reaches the executor and the key is the open question of nxr-rxzgbq; this issue follows its answer.

- [x] Apply the route that nxr-rxzgbq settles to this warning, with a test that runs a task of the changed target with the daemon on
- [x] Update `DES-DIAGNOSTICS` and `VER-TARGET-DEFAULT-GUARD`

Done when: the parts of the cited verification that cover this warning pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Summary of Changes

Taken into the pull request of nxr-w627dj and nxr-rxzgbq by the control plane's decision of 14 November 2026, so that the warnings' route is reviewed once.

- The warning for a target that differs from what the plugin inferred, where the plugin cannot tell which configuration changed it, goes the route of nxr-rxzgbq. `describeTargetDefaultChanges` places it on its project and target, `createMetadata` puts it under `cargo.targetWarnings`, and the executor prints it once at the start of each task of that target.
- The key needs nothing more where Nx can see the cause. A changed `inputs`, `outputs` or tag, an entry in `nx.json` (whose filter selects a tag that another plugin adds), and an entry from an extended file as far as `createNodes` sees it, are all in every key. `cache` turned on where the plugin leaves it off fails the task when it starts, so nothing is stored.
- What remains is a `dependsOn` that another plugin changes from files that no key holds. That is the limit that the decision for nxr-rxzgbq accepts (beyond what `createNodes` can see). No hook before the key is computed sees another plugin's contribution, so no choice remains, and it is stated in `DES-DIAGNOSTICS` and `DES-TARGET-DEFAULT-GUARD`.
- Test in `nx-rust/test/warnings.spec.ts`: another plugin tags `api`, and an entry filtered to the tag adds `^fmt-check`. The warning appears once at graph creation without the daemon, once in the output of `api:fmt-check` run alone with the daemon on, and not in `plain:fmt-check`. `VER-TARGET-DEFAULT-GUARD` says so.

Checks run: `pnpm nx run-many -t build lint test` (34 suites, 1038 tests, 1 todo), `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e --skip-nx-cache`, `mara schema validate`, `mara project validate` and `zban check`.
