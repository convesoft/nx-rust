---
title: Stop counting a virtual workspace's project below a paths folder as a redirected crate
status: in-progress
type: bug
priority: low
parent: nxr-w9qa5f
discovered_from: nxr-8sf4xw
created_at: 2026-11-14T09:35:21Z
---

Goal: the redirected crates of a `paths` entry are crates, as `DES-PROJECT-GRAPH` ("Redirected crates") and `DES-METADATA-REPORT` ("Crates below a `paths` folder") say, and no workspace project of a virtual root manifest.

Found while fixing nxr-8sf4xw. `redirectedCrates` in `nx-rust/src/graph/redirected-uses.ts` takes, for a `paths` entry, every folder at or below the entry's folder that a report describes *or that has an Nx project*, and that holds a `Cargo.toml`. A virtual workspace at or below that folder has a workspace project in its root folder and a `Cargo.toml` there, so it becomes a redirected crate with a project but no package. Every member that may use the redirected crates then gets an edge to that workspace project, or its folder as an input where the edge is left out. Discovery's own walk already leaves such a folder out (`noCrate` in `readPathDependencies`, `nx-rust/src/graph/discovery.ts`); the older filter over project roots does not. This predates nxr-8sf4xw and only adds invalidation and edges, so the cache stays correct (`GOAL-TRUSTED-CACHE`), but `nx graph` shows edges from members to a workspace project that cargo never builds.

Reproduction to check: in `patched-workspaces`, set `paths = ["../shared"]` in `rust/.cargo/config.toml` (`shared/` is a virtual workspace with the project `shared`) and look for an edge from `api` to `shared`.

- [x] Confirm the edge with a fixture test
- [x] Leave out a folder whose report shows a virtual manifest, and update `VER-GRAPH` if it needs a sentence
