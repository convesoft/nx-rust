---
title: List the option-reference errors among the init cases of VER-SETUP
status: todo
type: task
tags:
  - spec
parent: nxr-w9qa5f
discovered_from: nxr-9f4w3f
created_at: 2026-11-13T12:13:04Z
---

Goal: the enumeration in `VER-SETUP` (`nx-rust/docs/verification.mara.md`) of the graph-creation errors for which `init` fails and leaves `nx.json` unchanged matches the table of `DES-DIAGNOSTICS` again.

nxr-9f4w3f added five graph-creation errors to `DES-DIAGNOSTICS`, all from `DES-PLUGIN-OPTIONS`: an unknown top-level key, `inputs` without `"..."` on an inferred target, an `executor` or `command` on an inferred target, `affectedTests = true` as a `test` option without the workspace setting, and an `implicitDependencies` entry starting with `!` that would remove a Cargo edge. `VER-SETUP` says that `init` fails for every error in that table, which covers them, but its sentence "As that table stands, the cases are: …" lists only the older rows. That issue was not allowed to change `VER-SETUP`.

- [ ] Add the five cases to the list in `VER-SETUP`, or drop the list in favour of the general rule, as the maintainer prefers
- [ ] `mara schema validate` and `mara project validate` report `valid: true`

Done when: the checks above pass.
