---
title: Two plugin entries that receive one workspace create every project twice, and Nx joins their metadata lists
status: todo
type: bug
priority: low
discovered_from: nxr-ew8kb3
created_at: 2026-11-14T22:32:14Z
---

Goal: a repository whose `nx.json` has two entries of the plugin whose `include` and `exclude` both let a workspace's manifests through (such as `"plugins": ["@convesoft/nx-rust", {"plugin": "@convesoft/nx-rust", "include": ["rust/**"]}]`) gets each project, its targets and its metadata as one entry would give them, or a decision says what such a configuration means.

Context: each entry's `createNodes` creates the same projects, and Nx merges them: `mergeMetadata` in Nx 24.0.6 (`dist/src/project-graph/utils/project-configuration/target-merging.js`) appends lists two levels deep. Measured on the fixture `shared-executables` with those two entries (review of nxr-ew8kb3), with plugin isolation on and off: every target's `metadata.technologies` held `cargo` twice, `metadata.cargo.triples` of `build` and `doc` twice (five times without isolation), `metadata.cargo.digests` twice and on the workspace's `doc` six or nine times, the lockfile task's `members` likewise; `gamma:build`, `gamma:check` and `beta:test` still passed. nxr-ew8kb3 makes only the first entry that receives a project attach and print its warnings (`EntryView` and `warnsHere` in `nx-rust/src/graph/entries.ts`, `DES-DIAGNOSTICS`), so `metadata.cargo.warnings`, `configurationWarnings` and `targetWarnings` and the printed warnings are no longer doubled. Left: the other lists above; the warnings that discovery prints (`registration.ts`, `graph.discovery.warnings`), which every such entry prints; and the targets and named inputs themselves, which Nx merges key by key, so that entries with different options (`targetNames`, `envInputs`, `locked`) give a project a mix of both, decided by the order in which Nx merges them. `DES-PLUGIN-OPTIONS` ("Several entries") settles only the workspace-wide settings of such entries.

- [ ] Decide with the maintainer what two entries that receive one workspace mean: only the first entry by its place in `nx.json` creates the project (the others' options do not apply to it), the entries must agree on every option that changes a project, or graph creation refuses such entries
- [ ] Record the decision in `DES-PLUGIN-OPTIONS` and implement it, with tests with plugin isolation on and off
