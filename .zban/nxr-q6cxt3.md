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

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm format:check` pass.
