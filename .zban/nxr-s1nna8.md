---
title: Key the redirected crates that only a member without a project may use under workspace-build
status: todo
type: bug
priority: deferred
tags:
  - backlog
discovered_from: nxr-j8mj18
created_at: 2026-11-15T15:40:23Z
---

Goal: under `workspace-build` and `cargo`, a crate's key holds the redirected crates that any member of its workspace may use ("Crates outside the workspace" in `DES-INPUTS`), also where the only member that may use one has no Nx project.

Context: nxr-j8mj18 takes "the redirected crates that any member may use" from `redirectedUses` (`nx-rust/src/graph/redirected-uses.ts`), which works out uses for the members that Nx handed to the plugin only (`CargoWorkspace.members`). A member that an `exclude` of the plugin's entry, `.gitignore` or `.nxignore` keeps out still builds with the whole workspace, so a redirected crate that only such a member may use, through a registry or git dependency that a `[patch]`, `[replace]` or `paths` entry redirects, can change the features of the other members while their keys stay the same. The path crates that such a member reaches by path are covered already (`outsideCrates` in `nx-rust/src/graph/path-dependencies.ts` walks every member of the report). Exotic: it needs a member left out of Nx and a redirection that only it uses.

- [ ] Count the redirected uses of the members without a project in `outsideCrates`, for example by treating such a member as one that may use every redirected crate of its workspace (running more is allowed, `GOAL-TRUSTED-CACHE`)
- [ ] A `VER-CACHE-KEYS` row in a fixture with such a member

Done when: the row passes, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

Reproduction from the review of nxr-j8mj18 (15 November 2026): a member that the plugin's `exclude` leaves without a project uses a registry dependency that the workspace's `[patch]` redirects to a local fork. Changing the feature that the fork asks of a shared member left every hash unchanged, while real workspace tests went from passing to failing. The cause is that `outsideCrates` gets redirected uses only for members with projects (`nx-rust/src/graph/path-dependencies.ts`, about line 574).
