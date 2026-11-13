---
title: Fail graph creation on unknown target options in the nx metadata tables
status: done
type: feature
parent: nxr-w9qa5f
blocked_by:
  - nxr-xyq7c8
  - nxr-9f4w3f
discovered_from: nxr-wynx3g
created_at: 2026-11-13T11:02:57Z
closed_at: 2026-11-13T17:04:55Z
---

Goal: the graph-time check of `REQ-UNKNOWN-METADATA-OPTIONS` exists.

Implements `REQ-UNKNOWN-METADATA-OPTIONS` and the last paragraph of `DES-UNKNOWN-OPTIONS` (`nx-rust/docs/configuration.mara.md`), with its row in `DES-DIAGNOSTICS` (`nx-rust/docs/setup.mara.md`). Checked by the last paragraph of `VER-UNKNOWN-OPTIONS` and by the `init` case in `VER-SETUP`. Blocked by nxr-9f4w3f for the names of the target options and by nxr-xyq7c8, which reads the tables.

- [x] Check the target tables while the metadata tables are read, in `tableProblems` (`nx-rust/src/graph/target-tables.ts`), the one place where nxr-xyq7c8 checks each `targets.<name>` table against the target it addresses before merging it
- [x] Compare the keys with the `properties` of the executors' schemas (`nx-rust/src/executors/cargo/schema.json` and `run/schema.json`), so that the check and the executors cannot disagree (moved here from nxr-xyq7c8)
- [x] Graph tests for each table and configuration case of the verification

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Summary of Changes

- `optionProblems` in `nx-rust/src/graph/target-tables.ts`, called from `tableProblems`, checks the keys under `options` and each configuration of a target table whose target runs one of the plugin's executors. A key that the executor's schema does not declare fails graph creation; on an inferred target, so does a declared key that the target does not take (`targetTriple` on `test`, `allTargets` on `build`). `pluginVersion` fails on any such target, with a message that says only the plugin sets it, because a value set by hand would replace the plugin's version in the cache key (`GOAL-TRUSTED-CACHE`, decided in review). Each message names the manifest, the table header (target and configuration) and the key, offers a "did you mean" for case, dash and underscore variants, and lists the options the target takes. The tables are checked once all of a project's tables are merged, so an extra target is checked against the executor it has after the workspace's and the crate's tables are merged, whichever of them names it, with each message naming the manifest and table where the key was written; as in Nx's merge, a table that names another executor replaces the target, and the keys of the tables before it are not checked (found in review). Such an extra target is checked against the schema alone; an extra target with another executor or a `command`, and an inferred target that the table gives another executor or a command (already an error), are not checked. A workspace table under the name of an inferred target that no member has is not checked, as decided in review.
- One table and one reader for the executors and the check, after merging pull request #35: `optionTargets`/`targetTakes` in `nx-rust/src/executors/command.ts` (#35's, with `args`) decides which targets take each option for the cargo command, the task-time lines of `taskOptions` and the graph-time check; `declaredExecutorOptions()`/`declaredOptionsOf()` in `nx-rust/src/executors/declared-options.ts` reads the `properties` of the schemas that `executors.json` names for both the executors and the check, replacing #35's `declaredOptions(schemaFile)`. `pluginVersionOption` names the option the plugin sets itself. This did what nxr-mrzfad, filed in the first round, asked; it was deleted.
- Mara: `REQ-UNKNOWN-METADATA-OPTIONS` gains clauses for an option that the target does not take and for `pluginVersion`; `DES-PLUGIN-OPTIONS` says that a table that sets `pluginVersion` fails graph creation; one sentence in `DES-UNKNOWN-OPTIONS` for the option that the target does not take; the `DES-DIAGNOSTICS` row extended within its width; the Configuration page's status note no longer names this gap (#35's sentence removed).
- Tests: 18 graph tests in `nx-rust/test/configuration.spec.ts` (package and workspace tables, `options` and a named configuration, the project table of a root manifest without a crate, a target renamed through `targetNames`, options known to the executor but not given to the target, `pluginVersion` in options and in a configuration, a misspelling, `run`, a workspace `bench` table, an extra target, an extra target whose executor comes from the workspace table with options and with a configuration in the crate's table, and the reverse layering, a table that changes the executor, and known options accepted, `args` on `run` among them, with a crate's table that replaces a workspace `nx:run-commands` target); three `init` cases in `nx-rust/test/init.spec.ts` (an undeclared key, an option that the target does not take, `pluginVersion`), each asserting the message and that no file changed; #35's test in `nx-rust/test/run-arguments.spec.ts` now gets the task-time line for `allTargets` on `build` from a `project.json` and expects the graph-creation error for the same option in the crate's table, while its `run` table's `args` still passes graph creation and reaches the binary; the end-to-end table sets a known option through the installed package.
- Found: nxr-f83zcw (a `pluginVersion` from `targetDefaults`, `project.json` or the command line will replace the plugin's version in the key once nxr-fy4t4k sets it).
- Checks run on the final tree: `pnpm nx run-many -t build lint test` (19 suites, 542 tests passed), `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e` (20 tests passed), `mara schema validate`, `mara project validate` (valid, evaluation complete, 0 errors, 0 warnings), `zban check`.
