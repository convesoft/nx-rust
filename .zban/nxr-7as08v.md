---
title: Bring the init failures that VER-SETUP lists in line with the diagnostics table
status: in-progress
type: task
priority: low
tags:
  - spec
parent: nxr-w9qa5f
discovered_from: nxr-1jjzf7
created_at: 2026-11-13T16:21:48Z
---

Goal: the list that follows "As that table stands, the cases are:" in `VER-SETUP` (`nx-rust/docs/verification.mara.md`) names every error that `DES-DIAGNOSTICS` (`nx-rust/docs/setup.mara.md`) reports when the plugin loads or the graph is created.

The first sentence of that paragraph already requires `init` to fail for each such error; only the list that spells the cases out has fallen behind the table. Rows or parts of rows missing from it, found at e14459a together with nxr-1jjzf7:

- [ ] A root manifest or configuration file that cargo reads and that is no valid TOML (the cargo row, `DES-METADATA-REPORT`)
- [ ] A value in `targetNames` that is no target name (its row, `DES-PLUGIN-OPTIONS`)
- [ ] `locked` in the plugin options that is neither `true` nor `false` (`DES-INVOCATION`), whose row #28 added
- [ ] Two projects of the plugin with one name where one is a workspace project: the list says "two crates of one project name", while nxr-1jjzf7 widened the row to every project of the plugin (`REQ-PROJECT-NAMES`, `DES-PROJECT-GRAPH`)
- [ ] A `[workspace.metadata.nx.project]` table in a root manifest that defines a crate, the row nxr-1jjzf7 added (`DES-PROJECT-GRAPH`, `DES-METADATA-TABLES`)

Note: pull requests that add a row to the table have not kept this list current. Rewording the paragraph so that it relies on its first sentence, and keeps no list, would end that; that is a choice for whoever takes this issue, as long as `VER-SETUP` still requires a failing `init` for each such error.

Done when: the list names each such error of `DES-DIAGNOSTICS`, or the paragraph no longer keeps one, and `mara schema validate` and `mara project validate` report `valid: true` with complete evaluation.
