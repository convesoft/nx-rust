---
title: Reach a crate with a project that a crate reaches only through crates without a project
status: in-progress
type: bug
priority: high
parent: nxr-w9qa5f
discovered_from: nxr-d371vy
created_at: 2026-11-13T20:38:43Z
---

Goal: a crate that reaches a crate with a project only through path dependencies on crates without a project hashes that crate's inputs, and `nx affected` selects it when they change (`GOAL-TRUSTED-CACHE`, `REQ-INPUT-FILES`, `REQ-DEPENDENCY-EDGES`).

Found in the review of nxr-d371vy (pull request #49), reproduction `bridge.cjs` in the reviewer's folder. In the fixture `declared-files`, add the crate `rust/crates/bridge`, which depends on `api` by path and which `nx.json` excludes from the plugin. Then add the standalone crate `cross`, which depends on `bridge` by path. `cross` gets no edge to `api`. Its inputs hold `bridge`'s folder and `rust/Cargo.toml`, but nothing of `api`. A change to `api`'s source, and since nxr-d371vy to a file that `api` declares, leaves `cross:test`'s key the same: the result is restored, and `nx affected` does not select `cross`. This holds on `main` as well, with `api`'s source.

The cause: `DES-PROJECT-GRAPH` draws an edge only for a crate's own dependency on a crate with a project. `reachedWithoutProject` in `nx-rust/src/graph/path-dependencies.ts` stops at a crate with a project ("what lies behind a crate with a project reaches the crate through that project's own input"), which covers a project behind a project, but not a project behind a crate without one.

Not decided. The proposal is an edge from the crate to each crate with a project that it reaches through path dependencies on crates without a project, of the kinds cargo builds for it. Then `^default` brings that crate's folder, declared files and dependencies. Putting only its folder and declared files into the inputs would miss what lies behind it.

- [ ] The maintainer decides; update `DES-PROJECT-GRAPH`, `DES-INPUTS` and `VER-GRAPH` or `VER-CACHE-KEYS`
- [ ] Implement it, with the `bridge` reproduction as a test with the real hasher and `nx affected`, for a source file and a declared file of `api`
