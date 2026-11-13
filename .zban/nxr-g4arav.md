---
title: Add the shared artifact directory warning to the diagnostics
status: todo
type: task
tags:
  - spec
parent: nxr-w9qa5f
related:
  - nxr-dp5q0f
discovered_from: nxr-kq5pm5
created_at: 2026-11-13T09:41:54Z
---

Goal: the draft item `DES-DIAGNOSTICS` (`nx-rust/docs/setup.mara.md`) lists the notice that `DES-OUTPUTS` (`nx-rust/docs/caching.mara.md`) now requires when two or more Cargo workspaces report the same artifact directory and their `doc` targets therefore run uncached.

Context: nxr-kq5pm5 moved `doc` to the workspace project and added that rule to `DES-OUTPUTS`, which says the plugin reports it when the graph is created, as it does for an artifact directory outside the repository. `DES-DIAGNOSTICS` has a row for the second case only. Its rows and message formats are being specified under nxr-dp5q0f, so this can be done there or right after it.

- [ ] Add the case to `DES-DIAGNOSTICS` as a warning at graph creation, naming the workspaces and the shared directory
- [ ] Extend `VER-SETUP` or `VER-CARGO-UNCHANGED` if the policies then require it

Done when: the row is in `DES-DIAGNOSTICS`, and `mara schema validate` and `mara project validate` report `valid: true`.
