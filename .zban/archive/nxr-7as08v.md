---
title: Bring the init failures that VER-SETUP lists in line with the diagnostics table
status: done
type: task
priority: low
tags:
  - spec
parent: nxr-w9qa5f
discovered_from: nxr-1jjzf7
created_at: 2026-11-13T16:21:48Z
closed_at: 2026-11-14T10:00:52Z
---

Goal: the list that follows "As that table stands, the cases are:" in `VER-SETUP` (`nx-rust/docs/verification.mara.md`) names every error that `DES-DIAGNOSTICS` (`nx-rust/docs/setup.mara.md`) reports when the plugin loads or the graph is created.

The first sentence of that paragraph already requires `init` to fail for each such error; only the list that spells the cases out has fallen behind the table. Rows or parts of rows missing from it, found at e14459a together with nxr-1jjzf7:

- [x] A root manifest or configuration file that cargo reads and that is no valid TOML (the cargo row, `DES-METADATA-REPORT`)
- [x] A value in `targetNames` that is no target name (its row, `DES-PLUGIN-OPTIONS`)
- [x] `locked` in the plugin options that is neither `true` nor `false` (`DES-INVOCATION`), whose row #28 added
- [x] Two projects of the plugin with one name where one is a workspace project: the list says "two crates of one project name", while nxr-1jjzf7 widened the row to every project of the plugin (`REQ-PROJECT-NAMES`, `DES-PROJECT-GRAPH`)
- [x] A `[workspace.metadata.nx.project]` table in a root manifest that defines a crate, the row nxr-1jjzf7 added (`DES-PROJECT-GRAPH`, `DES-METADATA-TABLES`)

Note: pull requests that add a row to the table have not kept this list current. Rewording the paragraph so that it relies on its first sentence, and keeps no list, would end that; that is a choice for whoever takes this issue, as long as `VER-SETUP` still requires a failing `init` for each such error.

Done when: the list names each such error of `DES-DIAGNOSTICS`, or the paragraph no longer keeps one, and `mara schema validate` and `mara project validate` report `valid: true` with complete evaluation.

## Summary of Changes

- Took the option of the note: the paragraph of `VER-SETUP` relies on its first sentence (for every error that `DES-DIAGNOSTICS` reports when the plugin loads or the graph is created, `init` fails with graph creation's message, which says what the user can do, and changes no file) and keeps no list. It keeps the two facts that were not rows of the table (an unsupported Nx major stops `init` also without a `Cargo.toml`; a missing pinned toolchain gets no toolchain installed) and says that a problem in the plugin options is checked on a `nx.json` that registers the plugin with them.
- `nx-rust/test/init.spec.ts` now has an `init` case, remedy included, for each row this issue lists: a configuration file that cargo reads and that is no valid TOML (new) and a root manifest that is no valid TOML (the existing `tools/Cargo.toml` case, renamed), a `targetNames` value that is no target name, `locked` that is neither `true` nor `false`, a crate named like its workspace's workspace project, and a `[workspace.metadata.nx.project]` table in a root manifest that defines a crate. It also has new cases for rows that had no `init` case, whether in the old list or added since: an unknown key in the `project` table, a different `executor`, a `command`, `affectedTests = true` without the setting, an `implicitDependencies` entry with `!`, a `targetNames` key that names no inferred target, two entries with different values of a per-workspace setting, `pluginVersion` and replaced `inputs` from a `targetDefaults` entry, and the `fileInputs` row that #64 added (a pattern into the folder of another plugin's project). The two existing tests of a registered entry became rows of one table, and the two row-12 cases now assert the remedy.
- Not covered by an `init` case: `affectedTests` without the nextest runner, which is not implemented yet (nxr-tabkjx's task item now asks for the `init` case), and an installed Nx that lacks the internal parts that `DES-TARGET-DEFAULT-GUARD` runs, which `target-defaults.spec.ts` checks at graph creation; an `init` case for it needs a patched copy of Nx, more than a table row.
- Checks run: `mara schema validate`, `mara project validate` (valid, complete evaluation), `pnpm nx run-many -t build lint test` (1121 passed, 1 todo), `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e --skip-nx-cache` (30 passed), `zban check`.
