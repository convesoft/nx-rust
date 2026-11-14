---
title: Carry the envInputs and runtimeInputs of the crates behind a left-out edge
status: in-progress
type: bug
parent: nxr-w9qa5f
discovered_from: nxr-vaywmh
created_at: 2026-11-14T08:39:26Z
---

Goal: where `DES-PROJECT-GRAPH` leaves out a member's use of a crate with a project, the member's keys follow the variables and commands that the crates the edge would have brought add with `envInputs` and `runtimeInputs`, as they would through `^default` (`GOAL-TRUSTED-CACHE`, `DES-INPUTS`).

Found while fixing the review finding of nxr-vaywmh. In place of a left-out edge, the member's targets now get the folder, workspace manifest and declared files of the crate and of every crate cargo builds with it (`RedirectedUse.brings` in `nx-rust/src/graph/redirected-uses.ts`, the left-out entries in `path-dependencies.ts`). The edge would also have brought each crate's `default` named input, which holds the `envInputs` and `runtimeInputs` from that crate's own table and from its workspace's table (`namedInputs` in `nx-rust/src/graph/inputs.ts`). The fallback carries none of them. A variable that a crate behind the left-out edge declares, and that its build reads, can therefore change without changing the member's keys. The control plane's decision for nxr-vaywmh named only folders and declared files, so this was left out.

Related: a path dependency without a project carries only its `fileInputs` too (`DES-INPUTS`, "Declared files"). Decide whether both should carry `envInputs` and `runtimeInputs`.

- [ ] Decide, and update `DES-INPUTS` and `VER-CACHE-KEYS`
- [ ] Implement it, with a test with the real hasher in which a variable that a crate behind a left-out edge declares changes the member's keys
