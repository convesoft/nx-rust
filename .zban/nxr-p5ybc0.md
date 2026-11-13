---
title: Recognise path overrides in [patch] as dependencies on crates in the repository
status: todo
type: bug
priority: high
tags:
  - spec
parent: nxr-w9qa5f
discovered_from: nxr-1bv0wm
created_at: 2026-11-13T12:30:20Z
---

Goal: a crate whose registry dependency a `[patch]` (or `[replace]`) table redirects to a path in the repository gets the edge and the cache inputs that a plain path dependency gets.

`DES-METADATA-REPORT` recognises a dependency on another crate in the repository only by the path its entry carries in the `--no-deps` report, and `DES-PROJECT-GRAPH` and `DES-INPUTS` build on that. A `[patch]` entry is not applied in that report: checked on 2026-11-13 with cargo 1.100.0, a workspace with members `a` and `b`, `a` depending on `b = "0.1"` and the root manifest holding `[patch.crates-io] b = { path = "b" }`, reported `a`'s dependency on `b` with the crates.io source and no `path`. The plugin then creates no edge from `a` to `b`, so a change in `b` leaves the cache keys of `a` unchanged although cargo builds `a` against it (`GOAL-TRUSTED-CACHE`).

- [ ] Decide with the user how the plugin learns the patched paths without dependency resolution, and record it in Mara (an evidence item for the experiment above, and the designs it changes)
- [ ] Implement it, with a fixture or test case for a patched path dependency inside the workspace and across workspaces
- [ ] Extend `VER-GRAPH` (and `VER-CACHE-KEYS` where it concerns inputs) for the case
- [ ] Cover what `DES-LOCKFILE-HASHING` leaves to this issue: a `paths` override in Cargo's configuration, which cargo compiles while it calls the lockfile current, and the contents of a path package that a crate reaches only through `[patch]` or `[replace]`, which the lockfile digest names but no file input covers (`EVD-CARGO-LOCK-CHECK`); edges and inputs read from the `[patch]`, `[replace]` and `paths` tables

Done when: the parts of the cited verification that cover this pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Notes

Decided by the maintainer on 2026-11-13: #17 merges with this gap recorded, this issue blocks closing the 0.1 milestone, and a researcher writes the brief from which the maintainer decides the design.

Reproduction through real Nx and cargo, first by the reviewer of #17 and again on 2026-11-13 with the harness (cargo 1.100.0, `nx` 24.0.6). In a copy of the fixture `subfolder-workspace`, `rust/crates/api/Cargo.toml` declares `model = "0.1"` in place of `model = { path = "../model" }`, `rust/Cargo.toml` adds `[patch.crates-io]` with `model = { path = "crates/model" }`, and `rust/crates/api/project.json` adds a target `probe` with `"command": "true"` and `"inputs": ["default", "^default"]`. The control is the same copy without the first two changes.

- `cargo tree -p api --offline -e normal` in `rust/` printed the same in both: `api v0.1.0 (<repo>/rust/crates/api)` and `└── model v0.1.0 (<repo>/rust/crates/model)`.
- The graph's edges, control: `api->codegen api->model api->testkit rust->api rust->codegen rust->model rust->testkit`. Patched: the same without `api->model`.
- `nx show projects --affected --files=rust/crates/model/src/lib.rs`, control: `["model","api","rust"]`. Patched: `["model","rust"]`.
- The hash of `api:probe` before and after appending a comment to `rust/crates/model/src/lib.rs`, control: `12050355690854427487`, then `5950602836384170106`. Patched: `1862252299326980748` both times.
