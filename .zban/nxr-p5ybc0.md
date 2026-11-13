---
title: Recognise path overrides in [patch] as dependencies on crates in the repository
status: todo
type: bug
tags:
  - spec
discovered_from: nxr-1bv0wm
created_at: 2026-11-13T12:30:20Z
---

Goal: a crate whose registry dependency a `[patch]` (or `[replace]`) table redirects to a path in the repository gets the edge and the cache inputs that a plain path dependency gets.

`DES-METADATA-REPORT` recognises a dependency on another crate in the repository only by the path its entry carries in the `--no-deps` report, and `DES-PROJECT-GRAPH` and `DES-INPUTS` build on that. A `[patch]` entry is not applied in that report: checked on 2026-11-13 with cargo 1.100.0, a workspace with members `a` and `b`, `a` depending on `b = "0.1"` and the root manifest holding `[patch.crates-io] b = { path = "b" }`, reported `a`'s dependency on `b` with the crates.io source and no `path`. The plugin then creates no edge from `a` to `b`, so a change in `b` leaves the cache keys of `a` unchanged although cargo builds `a` against it (`GOAL-TRUSTED-CACHE`).

- [ ] Decide with the user how the plugin learns the patched paths without dependency resolution, and record it in Mara (an evidence item for the experiment above, and the designs it changes)
- [ ] Implement it, with a fixture or test case for a patched path dependency inside the workspace and across workspaces
- [ ] Extend `VER-GRAPH` (and `VER-CACHE-KEYS` where it concerns inputs) for the case

Done when: the parts of the cited verification that cover this pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
