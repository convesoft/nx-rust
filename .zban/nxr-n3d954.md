---
title: Check how Nx merges two plugins' projects in one folder
status: todo
type: task
priority: high
tags:
  - spike
parent: nxr-w9qa5f
created_at: 2026-11-12T18:20:01Z
---

Goal: establish the behaviour that `RISK-MIXED-PROJECT-MERGE` (`nx-rust/docs/decisions.mara.md`) leaves open, for a folder with both `Cargo.toml` and `package.json`. Moved into 0.1 on 2026-11-12, because the name of the workspace project depends on it.

- [ ] Which project name wins, depending on plugin order in `nx.json`
- [ ] What happens to targets both plugins infer, such as `build` and `test`
- [ ] Whether tags, implicit dependencies and metadata are merged
- [ ] The same for the workspace project when its folder already is an Nx project: a Cargo workspace at the repository root beside a root `package.json` or `project.json`
- [ ] Record the finding as an evidence item (`EVD-`) in `nx-rust/docs/decisions.mara.md` that supports or contradicts the items above
- [ ] Update the risk (likelihood, consequence, or retire it) and every design or decision the finding changes

Done when: the evidence item is accepted in Mara, and `mara project validate` reports `valid: true`.
