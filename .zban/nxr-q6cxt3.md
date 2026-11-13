---
title: Check compatibility and report missing tools
status: todo
type: feature
parent: nxr-w9qa5f
blocked_by:
  - nxr-dp5q0f
  - nxr-1bv0wm
created_at: 2026-11-12T18:20:01Z
---

Goal: unsupported versions, missing tools and contradictory options produce messages that say what is wrong and what to do.

Implements `REQ-COMPATIBILITY` and `REQ-DIAGNOSTICS` (`nx-rust/docs/setup.mara.md`). Checked by `VER-SETUP`.

- [ ] Version checks for Nx and Cargo with the found and required versions in the message
- [ ] The peer dependency range of the package names the supported Nx majors, `^24` at first
- [ ] Graph-time errors for the problems the design lists
- [ ] Task-time errors for a missing tool, naming the tool, the feature that needs it and how to get it
- [ ] Nothing is installed by the plugin
- [ ] `init` stops for each of these errors too, and for an unsupported Nx also in a repository without a `Cargo.toml`, with the tests that the third paragraph of `VER-SETUP` lists, the name collision of nxr-1bv0wm included. `init` runs the plugin's `createNodes` through Nx (`nx-rust/src/generators/init/graph-check.ts`), so a check made there reaches it; a check made when the plugin loads has to reach it as well
- [ ] Take the tools, how to get them and whether they are installed for the task-time errors from the table that `init` reports (`nx-rust/src/tools/optional-tools.ts`)

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
