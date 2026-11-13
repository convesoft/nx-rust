---
title: Account for implicit Cargo edges in the release flow
status: todo
type: task
tags:
  - spec
parent: nxr-6q2chq
related:
  - nxr-5fp9d3
discovered_from: nxr-1bv0wm
created_at: 2026-11-13T12:30:25Z
---

Goal: the release flow updates the crates that depend on a released crate although the plugin's edges are of Nx's type `implicit`.

The plugin returns every edge as `implicit` (`DES-PROJECT-GRAPH`, `EVD-NX-EDGE-CACHE`). The default `readDependencies` of Nx release's `VersionActions` leaves `implicit` edges out, so a `VersionActions` for `Cargo.toml` that keeps the default would find no dependents (`EVD-NX-EDGE-CACHE`, "Other readers of the type"). `DES-RELEASE` is a draft whose open points include dependents.

- [ ] When specifying the release flow (nxr-5fp9d3), decide where the `Cargo.toml` `VersionActions` reads dependents from: the graph without the type filter, or the manifests
- [ ] Cover it in the release verification

Done when: the release items cover the point and `mara schema validate` and `mara project validate` report `valid: true`.
