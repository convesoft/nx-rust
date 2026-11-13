---
title: Add the workspace project's name errors to the diagnostics table
status: todo
type: task
tags:
  - spec
parent: nxr-w9qa5f
blocked_by:
  - nxr-dp5q0f
discovered_from: nxr-gdt96k
created_at: 2026-11-13T10:49:39Z
---

Goal: once nxr-dp5q0f has accepted `DES-DIAGNOSTICS` (`nx-rust/docs/setup.mara.md`), add to its table the two graph-creation errors that nxr-gdt96k agreed for the workspace project. That issue did not write them into the then-draft item, because nxr-dp5q0f was rewriting it at the same time.

The errors are specified in `DES-PROJECT-GRAPH` (`nx-rust/docs/workspaces.mara.md`) and `DES-METADATA-TABLES` (`nx-rust/docs/configuration.mara.md`), with the rationale in `ADR-WORKSPACE-PROJECT-NAME`:

- [ ] Widen the row for two projects with one name (`REQ-PROJECT-NAMES`) from crates to all projects of the plugin, so that it also covers workspace projects
- [ ] Add a row for a `[workspace.metadata.nx.project]` table in a root manifest that defines a crate, detected when the graph is created
- [ ] Check that `VER-GRAPH` and `VER-CONFIGURATION` still cover both rows, and extend whichever check `DES-DIAGNOSTICS` itself is verified by if the policies require it

Done when: both rows are in the accepted `DES-DIAGNOSTICS`, and `mara schema validate` and `mara project validate` report `valid: true` with complete evaluation.
