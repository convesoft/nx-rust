---
title: Recognise path overrides in [patch] as dependencies on crates in the repository
status: done
type: bug
priority: high
tags:
  - spec
parent: nxr-w9qa5f
discovered_from: nxr-1bv0wm
created_at: 2026-11-13T12:30:20Z
closed_at: 2026-11-13T15:15:02Z
---

Goal: a crate whose registry dependency a `[patch]` (or `[replace]`) table redirects to a path in the repository gets the edge and the cache inputs that a plain path dependency gets.

`DES-METADATA-REPORT` recognises a dependency on another crate in the repository only by the path its entry carries in the `--no-deps` report, and `DES-PROJECT-GRAPH` and `DES-INPUTS` build on that. A `[patch]` entry is not applied in that report: checked on 2026-11-13 with cargo 1.100.0, a workspace with members `a` and `b`, `a` depending on `b = "0.1"` and the root manifest holding `[patch.crates-io] b = { path = "b" }`, reported `a`'s dependency on `b` with the crates.io source and no `path`. The plugin then creates no edge from `a` to `b`, so a change in `b` leaves the cache keys of `a` unchanged although cargo builds `a` against it (`GOAL-TRUSTED-CACHE`).

- [x] Decide with the user how the plugin learns the patched paths without dependency resolution, and record it in Mara (an evidence item for the experiment above, and the designs it changes)
- [x] Implement it, with a fixture or test case for a patched path dependency inside the workspace and across workspaces
- [x] Extend `VER-GRAPH` (and `VER-CACHE-KEYS` where it concerns inputs) for the case
- [x] Cover what `DES-LOCKFILE-HASHING` leaves to this issue: a `paths` override in Cargo's configuration, which cargo compiles while it calls the lockfile current, and the contents of a path package that a crate reaches only through `[patch]` or `[replace]`, which the lockfile digest names but no file input covers (`EVD-CARGO-LOCK-CHECK`); edges and inputs read from the `[patch]`, `[replace]` and `paths` tables

Done when: the parts of the cited verification that cover this pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Notes

Decided by the maintainer on 2026-11-13: #17 merges with this gap recorded, this issue blocks closing the 0.1 milestone, and a researcher writes the brief from which the maintainer decides the design.

Reproduction through real Nx and cargo, first by the reviewer of #17 and again on 2026-11-13 with the harness (cargo 1.100.0, `nx` 24.0.6). In a copy of the fixture `subfolder-workspace`, `rust/crates/api/Cargo.toml` declares `model = "0.1"` in place of `model = { path = "../model" }`, `rust/Cargo.toml` adds `[patch.crates-io]` with `model = { path = "crates/model" }`, and `rust/crates/api/project.json` adds a target `probe` with `"command": "true"` and `"inputs": ["default", "^default"]`. The control is the same copy without the first two changes.

- `cargo tree -p api --offline -e normal` in `rust/` printed the same in both: `api v0.1.0 (<repo>/rust/crates/api)` and `└── model v0.1.0 (<repo>/rust/crates/model)`.
- The graph's edges, control: `api->codegen api->model api->testkit rust->api rust->codegen rust->model rust->testkit`. Patched: the same without `api->model`.
- `nx show projects --affected --files=rust/crates/model/src/lib.rs`, control: `["model","api","rust"]`. Patched: `["model","rust"]`.
- The hash of `api:probe` before and after appending a comment to `rust/crates/model/src/lib.rs`, control: `12050355690854427487`, then `5950602836384170106`. Patched: `1862252299326980748` both times.

## Summary of Changes

The maintainer decided on 2026-11-13 from the research brief: read the redirection tables from files, give every member that could reach a redirected crate an edge to it, leave out an edge where the redirected crate reaches the member through normal or build dependencies and use inputs instead, and honour configuration outside the repository with a warning. The review of the pull request refined it (the control plane's decision): a dependency whose name, source and version requirement a redirected crate satisfies is a direct, real edge, always kept; other uses are possible edges, left out where the crate reaches the member through real normal or build dependencies, and both ways between two redirected crates that may only possibly use each other, which settled and replaced nxr-3yes4t. Recorded as `ADR-REDIRECTION-EDGES`, supported by `EVD-CARGO-REDIRECTIONS` (cargo 1.100.0 and 1.91.0); amended `DES-METADATA-REPORT`, `ADR-METADATA-NO-DEPS`, `DES-DISCOVERY`, `REQ-DEPENDENCY-EDGES`, `DES-PROJECT-GRAPH`, `ADR-ALL-DEP-KINDS`, `REQ-INPUT-FILES`, `DES-INPUTS`, `DES-LOCKFILE-HASHING`, `DES-DIAGNOSTICS`, `VER-GRAPH` and `VER-CACHE-KEYS`, and the guidance in `workspaces.mara.md` and `caching.mara.md`.

- `nx-rust/src/cargo/redirections.ts` reads `[patch]` and `[replace]` from each workspace's root manifest and `[patch]` and `paths` from the configuration cargo reads for the workspace (`.cargo/config` before `.cargo/config.toml`, folders up from the workspace root, the Cargo home, `include`, whose unreadable files are skipped with a warning), with `smol-toml` as #19 added it. `nx-rust/src/cargo/version-req.ts` evaluates Cargo version requirements and gives up on forms it does not know.
- Discovery keeps the redirections per workspace, requests a report for a redirected crate without a project, compared through symbolic links, goes on with a warning where cargo cannot report it, and warns, naming the file, for redirections in configuration outside the repository.
- `redirectedUses` in `nx-rust/src/graph/redirected-uses.ts` is the one place that says which member gets an edge to which redirected crate and which gets its folder as an input (`edge: false`, with `projectRoot` and `reported`); `projectEdges` adds the edges.
- The fixture `patched-workspaces`, `nx-rust/test/redirections.spec.ts` and `nx-rust/test/version-req.spec.ts` check the edges for every way of redirecting, the review's four reproductions, a git source, `nx show projects --affected`, the warnings, that every crate with a project that `cargo tree` shows for a member is reachable from it, and each requirement form against real cargo.

Inputs do not exist yet: the folder inputs for `edge: false` uses and the `VER-CACHE-KEYS` rows are a step of nxr-fy4t4k. Repeating the warnings from the executor is a step of nxr-q6cxt3. The step that pull request #14 added, for `paths` overrides and path packages reached through `[patch]` or `[replace]`: the edges bring their contents into the keys of the members that may use them through `^` inputs, as `DES-LOCKFILE-HASHING` now says, and the inputs part is the nxr-fy4t4k step.

Filed: nxr-9ezy43 (`cargo vendor` output in the graph), nxr-dj5tvp (git-ignored configuration with redirections), nxr-m60y0c (a path dependency that cargo builds but does not report fails graph creation).

Checks run, on `main` at 8995967 merged in: `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e`, `mara schema validate`, `mara project validate` (valid, complete evaluation, 0 errors, 0 warnings) and `zban check`. CI on the pull request covers the remaining runs.
