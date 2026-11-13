---
title: Decide whether .cargo/config without the .toml extension is a workspace file
status: todo
type: task
tags:
  - spec
parent: nxr-w9qa5f
discovered_from: nxr-fy4t4k
created_at: 2026-11-13T16:03:06Z
---

Goal: the workspace files of `DES-INPUTS` cover every configuration file that Cargo reads for the plugin's commands.

Context: `DES-INPUTS` names `.cargo/config.toml` in each folder from the crate to the repository root, and nxr-fy4t4k declares exactly those (`workspaceFiles` in `nx-rust/src/graph/inputs.ts`). Cargo also reads the older name `.cargo/config`, without the extension, and Cargo's documentation says that when both exist in one folder it uses the one without the extension (https://doc.rust-lang.org/cargo/reference/config.html, "Hierarchical structure"). A repository that still has `.cargo/config` can change `RUSTFLAGS`-like settings, `build.warnings` or the target triple with no change to any key (`GOAL-TRUSTED-CACHE`). Not checked by experiment yet: whether Cargo 1.91 and later still read the file and which one wins.

Options for the maintainer:

- Add `.cargo/config` beside `.cargo/config.toml` in each folder (recommended: it costs one input per folder and follows Cargo).
- Keep it out and say in the caching guide that the legacy name is not hashed.

- [ ] Check with cargo 1.91 and the latest stable which of the two files Cargo reads, and record it as evidence
- [ ] Decide with the user and update `DES-INPUTS`, `REQ-INPUT-FILES` and the caching guide as the answer requires; implement and test it

Done when: the user has agreed to the answer, the items are accepted, and `mara schema validate`, `mara project validate`, `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
