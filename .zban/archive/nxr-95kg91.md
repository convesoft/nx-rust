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

- `optionProblems` in `nx-rust/src/graph/target-tables.ts`, called from `tableProblems`, checks the keys under `options` and each configuration of a target table whose target runs one of the plugin's executors. A key that the executor's schema does not declare fails graph creation; on an inferred target, so does a declared key that the target does not take (`targetTriple` on `test`, `allTargets` on `build`). Each message names the manifest, the table header (target and configuration) and the key, offers a "did you mean" for case, dash and underscore variants, and lists the options the target takes. An extra target that names a plugin executor is checked against the schema alone; an extra target with another executor or a `command`, and an inferred target that the table gives another executor or a command (already an error), are not checked. `pluginVersion` is accepted, as the option reference gives it to every inferred target, but no message offers it.
- One source for both sides: `declaredExecutorOptions()` (`nx-rust/src/executors/declared-options.ts`) reads the `properties` of the schema that `executors.json` names for each executor, the file Nx validates against. The per-target applicability is `optionTargets`/`targetTakes` in `nx-rust/src/executors/command.ts`, which `cargoArguments` now uses as well, in the same shape as pull request #35.
- Mara: one sentence in `DES-UNKNOWN-OPTIONS` for the option that the target does not take; the `DES-DIAGNOSTICS` row extended within its width; the Configuration page's status note no longer names this gap.
- Tests: 14 graph tests in `nx-rust/test/configuration.spec.ts` (package and workspace tables, `options` and a named configuration, the project table of a root manifest without a crate, a target renamed through `targetNames`, options known to the executor but not given to the target, a misspelling, `run`, a workspace `bench` table, an extra target, a table that changes the executor, and known options with `pluginVersion` accepted); one `init` case in `nx-rust/test/init.spec.ts`; and the end-to-end table now sets a known option through the installed package.
- Checks run: `pnpm nx run-many -t build lint test` (16 suites, 485 tests passed), `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e` (19 tests passed), `mara schema validate`, `mara project validate` (valid, evaluation complete, 0 errors, 0 warnings), `zban check`.
