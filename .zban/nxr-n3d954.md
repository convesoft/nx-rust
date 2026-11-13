---
title: Check how Nx merges two plugins' projects in one folder
status: in-progress
type: task
priority: high
tags:
  - spike
parent: nxr-w9qa5f
created_at: 2026-11-12T18:20:01Z
---

Goal: establish the behaviour that `RISK-MIXED-PROJECT-MERGE` (`nx-rust/docs/decisions.mara.md`) leaves open, for a folder with both `Cargo.toml` and `package.json`. Moved into 0.1 on 2026-11-12, because the name of the workspace project depends on it.

- [x] Which project name wins, depending on plugin order in `nx.json`
- [x] What happens to targets both plugins infer, such as `build` and `test`
- [x] Whether tags, implicit dependencies and metadata are merged
- [x] The same for the workspace project when its folder already is an Nx project: a Cargo workspace at the repository root beside a root `package.json` or `project.json`
- [x] Record the finding as an evidence item (`EVD-`) in `nx-rust/docs/decisions.mara.md` that supports or contradicts the items above
- [ ] Update the risk (likelihood, consequence, or retire it) and every design or decision the finding changes

Done when: the evidence item is accepted in Mara, and `mara project validate` reports `valid: true`.

## Notes

- `EVD-NX-PROJECT-MERGE` is accepted, and `RISK-MIXED-PROJECT-MERGE` is updated: likelihood `almost-certain` (was `likely`), consequence unchanged, and it now also threatens `REQ-PROJECT-NAMES`.
- The finding contradicts accepted items for a crate folder that is also a JS project: `REQ-PROJECT-NAMES`, `ADR-PROJECT-NAMES` and `DES-PROJECT-GRAPH` name the project after the crate or its `name` override, but Nx applies `package.json` and `project.json` after every plugin. `DES-PROJECT-GRAPH` also needs edges to name projects by the merged name, looked up by root. The text of these items is unchanged until the maintainer agrees to the proposed wording; the last task item stays open until then.
- Not changed here, for their own issues: the draft `REQ-MIXED-PROJECTS` (nxr-ym403k) and the open name point of the draft `DES-WORKSPACE-TARGETS` (nxr-gdt96k).
- The experiment ran in a throwaway workspace outside the repository; the evidence item names the versions, the setup and the commands.
