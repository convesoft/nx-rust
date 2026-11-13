---
title: Add the workspace project's name errors to the diagnostics table
status: done
type: task
tags:
  - spec
parent: nxr-w9qa5f
blocked_by:
  - nxr-dp5q0f
discovered_from: nxr-gdt96k
created_at: 2026-11-13T10:49:39Z
closed_at: 2026-11-13T16:24:38Z
---

Goal: once nxr-dp5q0f has accepted `DES-DIAGNOSTICS` (`nx-rust/docs/setup.mara.md`), add to its table the two graph-creation errors that nxr-gdt96k agreed for the workspace project. That issue did not write them into the then-draft item, because nxr-dp5q0f was rewriting it at the same time.

The errors are specified in `DES-PROJECT-GRAPH` (`nx-rust/docs/workspaces.mara.md`) and `DES-METADATA-TABLES` (`nx-rust/docs/configuration.mara.md`), with the rationale in `ADR-WORKSPACE-PROJECT-NAME`:

- [x] Widen the row for two projects with one name (`REQ-PROJECT-NAMES`) from crates to all projects of the plugin, so that it also covers workspace projects
- [x] Add a row for a `[workspace.metadata.nx.project]` table in a root manifest that defines a crate, detected when the graph is created
- [x] Check that `VER-GRAPH` and `VER-CONFIGURATION` still cover both rows, and extend whichever check `DES-DIAGNOSTICS` itself is verified by if the policies require it

Done when: both rows are in the accepted `DES-DIAGNOSTICS`, and `mara schema validate` and `mara project validate` report `valid: true` with complete evaluation.

## Summary of Changes

`DES-DIAGNOSTICS` (`nx-rust/docs/setup.mara.md`): the row for two crates with one project name now covers every project of the plugin, crates and workspace projects. It says that the plugin's error follows Nx's, is promised under the names the plugin gave the projects and is best effort elsewhere, as `REQ-PROJECT-NAMES` and the "Projects" paragraph of `DES-PROJECT-GRAPH` say. The old clause on a collision with another plugin's project did not fit the column with the new text and was dropped; `DES-PROJECT-GRAPH`, which the row cites, still says it. A new row below it: a `[workspace.metadata.nx.project]` table in a root manifest that defines a crate fails graph creation, and the message points to `[package.metadata.nx]` (`DES-PROJECT-GRAPH`, `DES-METADATA-TABLES`). Both rows keep the table's column widths, and the formatter did not re-pad the table.

Verification: `VER-GRAPH` already checks collisions of workspace projects with each other and with crates, and `VER-CONFIGURATION` already checks the `[workspace.metadata.nx.project]` error, so neither changed. `VER-SETUP` verifies `REQ-DIAGNOSTICS`; its first sentence already covers both errors for `init`, and the Mara policies require nothing more. Its spelled-out list of cases was already behind the table on `main`, so nxr-7as08v now tracks bringing it up to date, these two rows included.

Implementation: the collision check is on `main` (nxr-1bv0wm, `nx-rust/src/graph/collisions.ts`). The `[workspace.metadata.nx.project]` error had no step in any open issue, so nxr-xyq7c8 has one now.

Checks run: `pnpm nx format:write`; `mara schema validate` and `mara project validate`, both `valid: true` with complete evaluation; `zban check`; `pnpm nx run-many -t build lint test`; `pnpm nx format:check --all`. All passed.
