---
title: Check how Nx merges two plugins' projects in one folder
status: done
type: task
priority: high
tags:
  - spike
parent: nxr-w9qa5f
created_at: 2026-11-12T18:20:01Z
closed_at: 2026-11-13T09:16:33Z
---

Goal: establish the behaviour that `RISK-MIXED-PROJECT-MERGE` (`nx-rust/docs/decisions.mara.md`) leaves open, for a folder with both `Cargo.toml` and `package.json`. Moved into 0.1 on 2026-11-12, because the name of the workspace project depends on it.

- [x] Which project name wins, depending on plugin order in `nx.json`
- [x] What happens to targets both plugins infer, such as `build` and `test`
- [x] Whether tags, implicit dependencies and metadata are merged
- [x] The same for the workspace project when its folder already is an Nx project: a Cargo workspace at the repository root beside a root `package.json` or `project.json`
- [x] Record the finding as an evidence item (`EVD-`) in `nx-rust/docs/decisions.mara.md` that supports or contradicts the items above
- [x] Update the risk (likelihood, consequence, or retire it) and every design or decision the finding changes

Done when: the evidence item is accepted in Mara, and `mara project validate` reports `valid: true`.

## Notes

- `EVD-NX-PROJECT-MERGE` is accepted, and `RISK-MIXED-PROJECT-MERGE` is updated: likelihood `almost-certain` (was `likely`), consequence unchanged, and it now also threatens `REQ-PROJECT-NAMES`.
- The finding contradicted accepted items for a crate folder that is also a JS project: `REQ-PROJECT-NAMES`, `ADR-PROJECT-NAMES` and `DES-PROJECT-GRAPH` named the project after the crate or its `name` override, but Nx applies `package.json` and `project.json` after every plugin. `DES-PROJECT-GRAPH` also needed edges to name projects by the merged name, looked up by root. The maintainer agreed to the proposed wording on 2026-11-13.
- Not settled here, for their own issues: the draft `REQ-MIXED-PROJECTS` (nxr-ym403k) and the open name point of the draft `DES-WORKSPACE-TARGETS` (nxr-gdt96k). Their `Open:` paragraphs now only cite the evidence.
- The experiment ran in a throwaway workspace outside the repository; the evidence item names the versions, the setup and the commands.

## Summary of Changes

- Ran the spike in a throwaway Nx 24.0.6 workspace with cargo 1.100.0 and a stand-in for the plugin, and recorded the result as `EVD-NX-PROJECT-MERGE` (accepted). It supports `RISK-MIXED-PROJECT-MERGE`, `REQ-WORKSPACE-PROJECT`, `REQ-PROJECT-NAMES`, `ADR-PROJECT-NAMES` and `DES-PROJECT-GRAPH`.
- `RISK-MIXED-PROJECT-MERGE`: rewritten from the finding; likelihood `almost-certain` (was `likely`), consequence `moderate` unchanged; now also threatens `REQ-PROJECT-NAMES`.
- With the maintainer's agreement of 2026-11-13: `REQ-PROJECT-NAMES`, `ADR-PROJECT-NAMES` and `DES-PROJECT-GRAPH` name a crate folder that is also a JS project by its `package.json` or `project.json`. They report a collision between two crates themselves and leave a collision with another plugin's project to Nx. `DES-PROJECT-GRAPH` names edges by the project Nx created at the crate's root. The `Open:` paragraphs of the drafts `REQ-MIXED-PROJECTS` and `DES-WORKSPACE-TARGETS` cite the evidence; both stay draft.
- User guidance: "Project names" in `workspaces.mara.md` and "One folder, two plugins" in `artifacts.mara.md` now match the changed items. "Project names" directs a rename to `name` in the folder's `project.json` when it has one, and otherwise to `nx.name` in its `package.json`.
- After review, with the cases re-run in the same throwaway workspace: `EVD-NX-PROJECT-MERGE` states the target compatibility rule as Nx applies it, including a missing executor, command or script. It says that metadata can survive a replacement. It says that an invalid edge source keeps the edges before it in the partial graph, and gives the fixture, the edge order and which outcomes were re-run. `RISK-MIXED-PROJECT-MERGE` now limits the misses to edges, since a `dependsOn` entry is rewritten. Follow-ups: nxr-ag3rec (names and overrides in `REQ-INFERRED-PROJECTS`, `REQ-METADATA-OVERRIDES` and `DES-METADATA-TABLES`), and a new task step on nxr-ym403k (the task-dependency exception in `ADR-NO-RUST-BUILD-DEPS`, `REQ-NO-RUST-TASK-DEPS` and `DES-TARGETS`).
- Checks: `mara schema validate` (valid) and `mara project validate` (`valid: true`, evaluation complete, 0 errors, 0 warnings), `zban check`, `pnpm nx format:check --all` and `pnpm nx run-many -t build lint test`, all passing on the final commit after review. `pnpm nx e2e nx-rust-e2e` was not run, because the built plugin did not change.
- Rejected approaches: none.
