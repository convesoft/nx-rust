---
title: Account for implicit Cargo edges in the release flow
status: done
type: task
tags:
  - spec
parent: nxr-6q2chq
related:
  - nxr-5fp9d3
discovered_from: nxr-1bv0wm
created_at: 2026-11-13T12:30:25Z
closed_at: 2026-11-14T15:49:59Z
---

Goal: the release flow updates the crates that depend on a released crate although the plugin's edges are of Nx's type `implicit`.

The plugin returns every edge as `implicit` (`DES-PROJECT-GRAPH`, `EVD-NX-EDGE-CACHE`). The default `readDependencies` of Nx release's `VersionActions` leaves `implicit` edges out, so a `VersionActions` for `Cargo.toml` that keeps the default would find no dependents (`EVD-NX-EDGE-CACHE`, "Other readers of the type"). `DES-RELEASE` is a draft whose open points include dependents.

- [x] When specifying the release flow (nxr-5fp9d3), decide where the `Cargo.toml` `VersionActions` reads dependents from: the graph without the type filter, or the manifests
- [x] Cover it in the release verification

Done when: the release items cover the point and `mara schema validate` and `mara project validate` report `valid: true`.

## Summary of Changes

Settled together with nxr-5fp9d3, in the same commit, as one point of the release specification.

The maintainer's answer of 14 November 2026 (D3, D3a, D3b of the research), word for word the option chosen: "Bump real dependents; rewrite everywhere (Recommended)". Dependents are read from the manifests, through the workspace's `cargo metadata --no-deps` report, not from the project graph; a crate becomes a dependent, and is bumped, through normal and build dependencies that carry a version requirement; dev-dependencies and path-only dependencies cause no bump; requirements on a bumped crate are rewritten in every manifest of the repository's Cargo workspaces, `[workspace.dependencies]` and crates outside the release included.

- `ADR-RELEASE-DEPENDENTS` (new, `decisions.mara.md`) records the choice, why the `implicit` edges are not used (the table of spurious dependents: crates reached through a crate without a project, the possible and assumed `[patch]`, `[replace]` and `paths` uses, the workspace project), and the rejected alternatives.
- `DES-RELEASE`, paragraphs Dependents and Requirements, specifies it; `DES-PROJECT-GRAPH` now points to the decision instead of to this issue.
- `VER-RELEASE` group 2 checks it with every edge `implicit`; group 3 checks the rewrites.
- `EVD-CARGO-PUBLISH` holds the measured fields of the `--no-deps` report (`req` is `*` for a path dependency without a version; the report does not say where a requirement is written) and the failure of every resolving cargo command after an inherited version is bumped without its requirements.

Checks: `mara schema validate` and `mara project validate` report `valid: true` with complete evaluation, 0 errors and 0 warnings; `pnpm nx format:check --all` passes; `zban check` reports no problems. No tests: this is specification only.
