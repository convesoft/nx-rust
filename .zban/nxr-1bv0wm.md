---
title: Create projects, names and edges
status: todo
type: feature
priority: high
parent: nxr-w9qa5f
blocked_by:
  - nxr-7n0nqf
  - nxr-gdt96k
created_at: 2026-11-12T18:20:01Z
---

Goal: turn the metadata reports into Nx projects and dependencies.

Implements `REQ-INFERRED-PROJECTS`, `REQ-PROJECT-NAMES`, `REQ-CROSS-WORKSPACE-DEPS`, `REQ-WORKSPACE-PROJECT`, `REQ-DEPENDENCY-EDGES` and `DES-PROJECT-GRAPH` (`nx-rust/docs/workspaces.mara.md`). Checked by `VER-GRAPH`.

- [ ] A project per member, rooted at the crate, named after the package
- [ ] The name-collision error with both manifest paths
- [ ] The workspace project, or the root crate in that role
- [ ] Edges for normal, build and dev-dependencies, including across workspaces and through cycles, found through the paths in the `--no-deps` report; no edge for a path dependency without a project
- [ ] No external nodes yet: they come with nxr-xq9ava (`DES-PROJECT-GRAPH`)
- [ ] Commands address crates by real package name and manifest path

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm format:check` pass.
