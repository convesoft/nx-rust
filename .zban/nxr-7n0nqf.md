---
title: Discover Cargo workspaces and load cargo metadata
status: todo
type: feature
priority: high
parent: nxr-w9qa5f
created_at: 2026-11-12T18:20:01Z
---

Goal: find every Cargo workspace in the repository with one cargo call each, and keep one metadata report per workspace for the rest of the graph computation.

Implements `REQ-MULTI-WORKSPACE`, `REQ-SKIP-CRATES`, `DES-DISCOVERY` and `DES-METADATA-REPORT` (`nx-rust/docs/workspaces.mara.md`). Checked by `VER-GRAPH`.

- [ ] Register the plugin for `Cargo.toml` files. `exclude` is Nx's own filter on the plugin entry, so it needs a test and no code
- [ ] Request reports with `--no-deps` (`ADR-METADATA-NO-DEPS`), and one more for a path dependency outside the workspace that has no project
- [ ] The claim loop of `DES-DISCOVERY`: shallowest unclaimed manifest, `cargo metadata`, claim the members
- [ ] Standalone crates and excluded members become workspaces of one
- [ ] Graph creation fails, naming the manifest, when cargo is missing or `cargo metadata` fails; no workspace is left out
- [ ] One report per workspace, shared between `createNodes` and `createDependencies`
- [ ] Tests on the fixtures, including the count of cargo invocations

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
