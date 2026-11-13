---
title: Decide the name of the workspace project
status: done
type: task
priority: high
tags:
  - spec
parent: nxr-w9qa5f
blocked_by:
  - nxr-n3d954
discovered_from: nxr-kcymxy
created_at: 2026-11-12T20:50:19Z
closed_at: 2026-11-13T11:43:02Z
---

Goal: decide what the workspace project is called, and what happens when its folder already is an Nx project, such as a Cargo workspace at the repository root. `REQ-WORKSPACE-PROJECT` and `DES-PROJECT-GRAPH` are accepted without a name, and project creation needs one. The name is a property of the project, recorded in `DES-PROJECT-GRAPH`; nxr-kq5pm5 took the point out of `DES-WORKSPACE-TARGETS` (`nx-rust/docs/targets.mara.md`), which is accepted without it.

The answer depends on how Nx merges two projects at one root, which the spike that blocks this issue establishes (`RISK-MIXED-PROJECT-MERGE`).

- [x] Propose a name rule to the user from the spike's evidence item: the default name, the override in `[workspace.metadata.nx]`, and the case of an existing project at the same root
- [x] Record the agreed rule in `DES-PROJECT-GRAPH`
- [x] Extend `VER-GRAPH` with the name and with the case of a workspace at the repository root

Done when: the user has agreed to the rule, and `mara schema validate` and `mara project validate` report `valid: true`.

## Summary of Changes

- The maintainer agreed to the rule on 2026-11-13, answering all nine questions of the decision brief with the recommended option. For a workspace whose root manifest defines no crate, the workspace project is named after the workspace folder's path from the Nx root, with each `/` replaced by `-`, and is called `cargo-workspace` at that root. `[workspace.metadata.nx.project]` sets its `name`, `tags` and `targets`; that table is an error in a root manifest with `[package]`, and `namePrefix` does not apply to the workspace project. A collision between any two projects of the plugin fails with the plugin's error, while one with a JS project stays Nx's error. Where Nx takes the name from the folder's `project.json` or `package.json`, the override has no effect. No characters are checked or rewritten.
- Recorded in `DES-PROJECT-GRAPH`, with `REQ-PROJECT-NAMES`, `REQ-METADATA-OVERRIDES` and `DES-METADATA-TABLES` extended as agreed. The new accepted `ADR-WORKSPACE-PROJECT-NAME` records the alternatives, and the new accepted `EVD-WORKSPACE-PROJECT-NAMES` records the experiments with cargo 1.100.0 and Nx 24.0.6. `VER-GRAPH` and `VER-CONFIGURATION` are extended, and the guidance in `workspaces.mara.md` and `configuration.mara.md` is updated. nxr-kq5pm5 (#8) took the name point out of `DES-WORKSPACE-TARGETS`.
- Review of #11: the default names are determined by the folder alone and are not unique (`services/billing/` and `services-billing/`, the root and `cargo-workspace/`); both cases were reproduced and recorded. The guidance now says that a `project.json` without a name and without a `package.json` beside it keeps the plugin's name. The evidence now states when Nx reads a `package.json`, and `VER-GRAPH` gained the checks the reviewer asked for.
- Checks on the final commit: `pnpm nx format:write`, `mara schema validate` (valid), `mara project validate` (`valid: true`, evaluation complete, 0 errors, 0 warnings), `zban check`, `pnpm nx run-many -t build lint test` (21 tests passed) and `pnpm nx format:check --all`, all passing. `pnpm nx e2e nx-rust-e2e` was not run, because the built plugin did not change.
- Follow-up: nxr-1jjzf7 adds the two graph-creation errors to `DES-DIAGNOSTICS` once nxr-dp5q0f has accepted it.
- Rejected approaches, recorded in `ADR-WORKSPACE-PROJECT-NAME`:
  - for the default name: the folder's last segment, a `-workspace` suffix, one fixed name, `rust` at the root, and the root `package.json` name
  - for the sub-table: `workspaceProject`, `root` and a flat `name` key
