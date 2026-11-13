---
title: A pluginVersion from targetDefaults, project.json or the command line replaces the plugin's version in the cache key
status: todo
type: bug
priority: high
parent: nxr-w9qa5f
related:
  - nxr-fy4t4k
discovered_from: nxr-95kg91
created_at: 2026-11-13T17:10:48Z
---

Goal: a value of `pluginVersion` that the plugin did not set cannot take the place of the plugin's version in a task's key (`GOAL-TRUSTED-CACHE`, `DES-INPUTS`, `DES-PLUGIN-OPTIONS`).

Context: nxr-95kg91 makes a target table in Cargo metadata that sets `pluginVersion` fail graph creation (`REQ-UNKNOWN-METADATA-OPTIONS`). The same option from a source that the plugin does not own is not checked. Today the executors declare it and every inferred target takes it (`optionTargets` in `nx-rust/src/executors/command.ts`), so a task takes a value from a `targetDefaults` entry, a `project.json` or `package.json`, or `--pluginVersion` on the command line without a line, leaves it out of the cargo command, and Nx hashes it into the key. The plugin does not set the option itself yet, so there is nothing for it to replace. Once nxr-fy4t4k puts the plugin's version into `pluginVersion` where Nx has no node for the package (`configureCaching` in pull request #33), Nx lays `targetDefaults`, `project.json` and `package.json` over the plugin's target and the command line over all of them, as `DES-PLUGIN-OPTIONS` ("Precedence") describes, so such a value replaces the plugin's version in the key. After a plugin upgrade, Nx could then restore results that the older plugin produced.

- [ ] Decide in Mara where such a value is caught, for example graph creation in `createDependencies`, which sees the merged targets as `failOnAffectedTestsOption` does, or the executor before cargo runs; the command line is seen only by the executor
- [ ] Implement it, with tests over a fixture for each source
- [ ] Add the row to `DES-DIAGNOSTICS` and the case to the verification

Done when: with the plugin's version in `pluginVersion`, a `targetDefaults` entry, a `project.json` and `--pluginVersion` that set another value each fail as the decided item says, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
