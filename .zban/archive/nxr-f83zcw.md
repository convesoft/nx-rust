---
title: A pluginVersion from targetDefaults, project.json or the command line replaces the plugin's version in the cache key
status: done
type: bug
priority: high
parent: nxr-w9qa5f
related:
  - nxr-fy4t4k
discovered_from: nxr-95kg91
created_at: 2026-11-13T17:10:48Z
closed_at: 2026-11-13T19:27:52Z
---

Goal: a value of `pluginVersion` that the plugin did not set cannot take the place of the plugin's version in a task's key (`GOAL-TRUSTED-CACHE`, `DES-INPUTS`, `DES-PLUGIN-OPTIONS`).

Context: nxr-95kg91 makes a target table in Cargo metadata that sets `pluginVersion` fail graph creation (`REQ-UNKNOWN-METADATA-OPTIONS`). The same option from a source that the plugin does not own is not checked. Today the executors declare it and every inferred target takes it (`optionTargets` in `nx-rust/src/executors/command.ts`), so a task takes a value from a `targetDefaults` entry, a `project.json` or `package.json`, or `--pluginVersion` on the command line without a line, leaves it out of the cargo command, and Nx hashes it into the key. The plugin does not set the option itself yet, so there is nothing for it to replace. Once nxr-fy4t4k puts the plugin's version into `pluginVersion` where Nx has no node for the package (`configureCaching` in pull request #33), Nx lays `targetDefaults`, `project.json` and `package.json` over the plugin's target and the command line over all of them, as `DES-PLUGIN-OPTIONS` ("Precedence") describes, so such a value replaces the plugin's version in the key. After a plugin upgrade, Nx could then restore results that the older plugin produced.

- [x] Decide in Mara where such a value is caught, for example graph creation in `createDependencies`, which sees the merged targets as `failOnAffectedTestsOption` does, or the executor before cargo runs; the command line is seen only by the executor
- [x] Implement it, with tests over a fixture for each source
- [x] Add the row to `DES-DIAGNOSTICS` and the case to the verification

Done when: with the plugin's version in `pluginVersion`, a `targetDefaults` entry, a `project.json` and `--pluginVersion` that set another value each fail as the decided item says, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Summary of Changes

The control plane decided where such a value is caught, on the basis of `GOAL-TRUSTED-CACHE` and of the rule already agreed for the same option in the metadata tables (nxr-95kg91): a `pluginVersion` that the plugin did not set is an error. It is never a warning and never ignored. From `targetDefaults`, a `project.json` or a `package.json`, it fails graph creation in `createDependencies`. From the command line, which only the executor sees, it fails the task before cargo runs. `DES-PLUGIN-OPTIONS` records the rule, and `DES-DIAGNOSTICS` has a row for each place.

Reproduced first with Nx's own hasher (`subfolder-workspace`, the plugin loaded by path, its version changed from 1.0.0 to 1.0.1). The key of `api:test` stayed the same where `pluginVersion` covered every target of `api` and of the crates its key holds. That was so through a `targetDefaults` entry per executor, through `project.json` and through `package.json`. A value on `test` alone, or on the command line, still changed the key, because Nx hashes every target's options of each such project and the command line beside them. This is recorded as a bullet in `EVD-NX-24-PLUGIN-VERSION`.

- `nx-rust/src/graph/plugin-version.ts`: `failOnPluginVersionOption` compares, on each inferred target that still runs the plugin's executor, the merged `options.pluginVersion` with the plugin's own value and fails on any `pluginVersion` in a configuration. The message groups the targets by project under where the value comes from.
- `nx-rust/src/graph/target-defaults.ts`: `optionOrigins` reuses the layers that the target-default guard rebuilds with Nx's own code to name the folder's `project.json` or `package.json`, or the `targetDefaults` entry and element. Where those layers do not show the value, as with another plugin, the message gives `nx show target … --json` for each target. The default nodes now keep their file.
- `nx-rust/src/executors/task.ts`: a run whose `pluginVersion` differs from the target's fails before cargo runs. Words after `--` that `run` passes to its binary are not affected.
- Tests: `nx-rust/test/plugin-version.spec.ts` covers each source, a list element with a configuration, another plugin, Nx with a node for the package, the plugin's own value repeated, `--pluginVersion`, and `run -- --pluginVersion`. `init.spec.ts` covers the `project.json` case.

Checks run: `pnpm nx run-many -t build lint` and `pnpm nx test nx-rust --maxWorkers=6` in place of `run-many -t build lint test`, for this machine's memory: 25 suites and 732 tests passed. `pnpm nx format:check --all` passed. `pnpm nx e2e nx-rust-e2e --skip-nx-cache`: 27 tests passed. `mara schema validate` and `mara project validate`: valid, evaluation complete, no errors or warnings. `zban check` was also run.

Not done: a design that carries the version in an input the user cannot replace, instead of an option that Nx merges. It is proposed in the pull request for the maintainer to decide.
