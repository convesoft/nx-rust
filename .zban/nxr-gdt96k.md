---
title: Decide the name of the workspace project
status: todo
type: task
priority: high
tags:
  - spec
parent: nxr-w9qa5f
blocked_by:
  - nxr-n3d954
discovered_from: nxr-kcymxy
created_at: 2026-11-12T20:50:19Z
---

Goal: settle the first open point of the draft item `DES-WORKSPACE-TARGETS` (`nx-rust/docs/targets.mara.md`): what the workspace project is called, and what happens when its folder already is an Nx project, such as a Cargo workspace at the repository root. `REQ-WORKSPACE-PROJECT` and `DES-PROJECT-GRAPH` are accepted without a name, and project creation needs one.

The answer depends on how Nx merges two projects at one root, which the spike that blocks this issue establishes (`RISK-MIXED-PROJECT-MERGE`).

- [ ] Propose a name rule to the user from the spike's evidence item: the default name, the override in `[workspace.metadata.nx]`, and the case of an existing project at the same root
- [ ] Record the agreed rule in `DES-PROJECT-GRAPH` and take the point out of the `Open:` paragraph of `DES-WORKSPACE-TARGETS`
- [ ] Extend `VER-GRAPH` with the name and with the case of a workspace at the repository root

Done when: the user has agreed to the rule, and `mara schema validate` and `mara project validate` report `valid: true`.
