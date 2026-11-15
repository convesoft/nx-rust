---
title: Warn every member about a path crate outside the workspace whose files Nx cannot see, under workspace-build
status: todo
type: bug
priority: deferred
tags:
  - backlog
discovered_from: nxr-j8mj18
created_at: 2026-11-15T15:40:29Z
---

Goal: under `workspace-build` and `cargo`, a crate whose key should hold a path crate outside its workspace ("Crates outside the workspace" in `DES-INPUTS`) but cannot, because the crate lies outside the repository or `.gitignore` or `.nxignore` leaves it out, gets the warning of `DES-DIAGNOSTICS` that the crate which depends on it gets.

Context: since nxr-j8mj18, every target that reads digests holds the folders of the path crates outside the workspace that any member reaches. For one whose files Nx cannot see, the plugin can put only the variables and commands it adds into the keys (`crateInputs` in `nx-rust/src/graph/path-dependencies.ts`), and only the members that reach it by path or redirection get `unseenPathDependencyWarning`; that warning says that a change there changes no key of that member or its dependents. The other members, whose features a build of the whole workspace can take from that crate, are not told. Decide with the maintainer whether they get a warning of their own, then record it in `DES-INPUTS` and `DES-DIAGNOSTICS`.

- [ ] Agree what the other members are told, and record it in Mara
- [ ] Implement it, with the case of `VER-SETUP` or `VER-CACHE-KEYS` that the decision names

Done when: the cited verification passes, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
