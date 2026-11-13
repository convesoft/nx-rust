---
title: Add the unknown-option rows to the diagnostics table
status: todo
type: task
parent: nxr-w9qa5f
blocked_by:
  - nxr-dp5q0f
discovered_from: nxr-wynx3g
created_at: 2026-11-13T11:03:02Z
---

Goal: the table of `DES-DIAGNOSTICS` (`nx-rust/docs/setup.mara.md`) lists the two checks that `DES-UNKNOWN-OPTIONS` defines.

`DES-DIAGNOSTICS` was still a draft on main when nxr-wynx3g closed, and nxr-dp5q0f accepts it, so the rows wait for that issue.

- [ ] Add a row for an option the cargo executor does not know, from a target default, `project.json`, `package.json` or the command line (`REQ-UNKNOWN-OPTIONS`): detected when the task starts, a warning in the task's output
- [ ] Add a row for an unknown key under `options` of a `targets.<name>` table in a metadata table (`REQ-UNKNOWN-METADATA-OPTIONS`): detected when the graph is created, an error

Done when: the rows are in the accepted table, and `mara schema validate`, `mara project validate` (`valid: true`) and `pnpm nx format:check --all` pass.
