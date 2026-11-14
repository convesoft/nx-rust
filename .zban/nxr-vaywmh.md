---
title: Reach a crate with a project behind a redirected crate without a project
status: draft
type: bug
priority: high
parent: nxr-w9qa5f
discovered_from: nxr-08gwaj
created_at: 2026-11-13T21:54:25Z
---

Goal: a member that uses a crate without a project through `[patch]`, `[replace]` or `paths` hashes the inputs of the crates with a project behind that crate, and `nx affected` selects it when they change (`GOAL-TRUSTED-CACHE`, `REQ-INPUT-FILES`, `REQ-DEPENDENCY-EDGES`).

Found while fixing nxr-08gwaj. That issue gives a crate an edge to each crate with a project that it reaches through path dependencies on crates without a project (`DES-PROJECT-GRAPH`, "Edges"). The same hole remains where the first crate without a project is reached through a redirection rather than a path dependency: `findCrateFolders` in `nx-rust/src/graph/path-dependencies.ts` puts the redirected crate's folder and the crates without a project behind it into the member's inputs, but stops at a crate with a project, and neither `projectEdges` nor `redirectedUses` gives the member an edge to it.

Reproduction, on the branch of nxr-08gwaj: in `patched-workspaces`, make `third_party/fork` (excluded, redirected by `rust`'s `[patch.crates-io]`, used by `api` through `fork = "0.1"`) depend on `plain = { path = "../../rust/crates/plain" }` in place of `model = "0.1"`. `api` gets edges to `model` and `types` only, and its `default` input holds `third_party/fork/**/*` but nothing of `plain`, so a change to `plain` leaves `api`'s keys the same.

Not decided: whether the walk of `projectsBehindCratesWithoutProject` (`nx-rust/src/graph/reached-projects.ts`) should also start from the redirected crates without a project that a member uses, for direct, possible and assumed uses alike, and how a possible or assumed use of such a crate weighs against an edge in the opposite direction.

- [ ] Decide, and update `DES-PROJECT-GRAPH`, `DES-INPUTS` and `VER-GRAPH` or `VER-CACHE-KEYS`
- [ ] Implement it, with the reproduction above as a test with the real hasher and `nx affected`
